import { groq, openai, openrouter } from "./clients";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  jsonMode?: boolean;
  temperature?: number;
}

interface Provider {
  name: string;
  call: (opts: ChatOptions) => Promise<string>;
}

// Explicit cap on all three providers. Without this, OpenRouter's default
// max_tokens for gpt-4o-mini (16384) gets requested up front regardless of
// how much the response actually needs — confirmed in practice this made
// OpenRouter fail outright ("requested up to 16384 tokens, but can only
// afford 14981") even though the account had real credit, just not enough
// for the unrequested default ceiling. Our JSON responses run a few KB;
// 4096 output tokens is comfortably more than any pass needs.
const MAX_OUTPUT_TOKENS = 4096;

async function callGroq({ messages, jsonMode, temperature = 0.3 }: ChatOptions) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    temperature,
    max_tokens: MAX_OUTPUT_TOKENS,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from Groq");
  return content;
}

async function callOpenAI({ messages, jsonMode, temperature = 0.3 }: ChatOptions) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature,
    max_tokens: MAX_OUTPUT_TOKENS,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");
  return content;
}

async function callOpenRouter({ messages, jsonMode, temperature = 0.3 }: ChatOptions) {
  const completion = await openrouter.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages,
    temperature,
    max_tokens: MAX_OUTPUT_TOKENS,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenRouter");
  return content;
}

// Tried in order: Groq (fast, cheap) → OpenAI → OpenRouter. Any failure on
// one provider (quota, rate limit, auth, whatever) moves to the next —
// simplest and most robust for uptime, since a provider-specific error
// doesn't tell us anything about whether the next provider will also fail.
const PROVIDERS: Provider[] = [
  { name: "Groq", call: callGroq },
  { name: "OpenAI", call: callOpenAI },
  { name: "OpenRouter", call: callOpenRouter },
];

/**
 * Chat completion with automatic provider failover across Groq → OpenAI →
 * OpenRouter. The caller/user never sees a raw provider error unless ALL
 * three are actually down at once.
 */
export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    try {
      return await provider.call(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${msg}`);
      console.warn(`${provider.name} failed, trying next provider: ${msg}`);
    }
  }

  throw new Error(`All LLM providers unavailable. ${errors.join(" | ")}`);
}
