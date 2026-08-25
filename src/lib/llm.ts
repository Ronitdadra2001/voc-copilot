import { groq, openai, openrouter, GEMINI_API_KEY } from "./clients";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  jsonMode?: boolean;
  temperature?: number;
  // Per-call override. Without one, defaults to a conservative value that
  // fits Groq's account-wide 8,000-tokens/minute cap (confirmed via
  // response headers — applies across models, a smaller model doesn't get
  // a bigger budget) alongside a small knowledge-base prompt. Passes with a
  // small prompt but a large, deeply-nested JSON schema (e.g. the product/
  // finance pass's issues+Porter's+finance object) need a caller-supplied
  // higher value, or the response silently truncates mid-JSON and fails
  // schema validation — confirmed in practice: the default value cut off a
  // response before it reached the porters_five_forces/finance fields.
  maxTokens?: number;
}

interface Provider {
  name: string;
  call: (opts: ChatOptions) => Promise<string>;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Groq's tokens-per-minute cap is a ROLLING window shared across every call
// in this account, not a per-request ceiling — confirmed in practice: a
// full report runs 3-4 sequential/parallel Groq calls, and even with each
// individual request sized to fit under the cap, back-to-back calls within
// the same report generation exhausted the rolling window (a 429 with
// "Used 7346, Requested 5891" against an 8000 limit). Groq's own error
// message states exactly how many seconds until the window frees up —
// parse and wait that out once, capped so a single retry can't run away
// the serverless function's execution budget, rather than immediately
// cascading to OpenAI/OpenRouter, which were both already exhausted anyway
// when this was observed live.
const GROQ_RETRY_WAIT_CAP_MS = 20000;

function parseGroqRetryAfterMs(message: string): number | null {
  const match = message.match(/try again in ([\d.]+)s/i);
  if (!match) return null;
  const seconds = parseFloat(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.ceil(seconds * 1000) + 500, GROQ_RETRY_WAIT_CAP_MS);
}

// Groq retired every meta-llama/* chat model from its lineup (confirmed
// directly via GET /v1/models on this account: llama-3.3-70b-versatile no
// longer appears at all, returning a 404 "does not exist" instead of the
// old 429 rate-limit) and now serves OpenAI's open-weight models instead.
// gpt-oss-120b is the closest quality tier to the old 70B llama model.
async function callGroqOnce(opts: ChatOptions) {
  const { messages, jsonMode, temperature = 0.3, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS } = opts;
  const params = {
    model: "openai/gpt-oss-120b",
    messages,
    temperature,
    max_tokens: maxTokens,
    // gpt-oss models spend hidden reasoning tokens before the final answer
    // — confirmed live: a tight max_tokens let reasoning alone consume the
    // whole budget, returning a completely empty content field ("Failed to
    // validate JSON... failed_generation: ''"). Forcing low reasoning
    // effort leaves the token budget for the actual JSON answer instead.
    // Not in the SDK's typed params (Groq-specific extension), hence the
    // any-typed spread below rather than an inline object cast.
    reasoning_effort: "low",
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const completion = await groq.chat.completions.create(params);
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from Groq");
  return content;
}

async function callGroq(opts: ChatOptions) {
  try {
    return await callGroqOnce(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const waitMs = parseGroqRetryAfterMs(msg);
    if (waitMs === null) throw err;
    await sleep(waitMs);
    return await callGroqOnce(opts);
  }
}

// Gemini's OpenAI-compatible endpoint, free tier — added as a fourth
// provider specifically because Groq (daily cap), OpenAI (zero quota), and
// OpenRouter (near-zero credit balance) were all exhausted on the same day
// during heavy testing, leaving no working fallback at all.
// Gemini's native REST API — confirmed against Google's own generated cURL
// quickstart for this key: X-goog-api-key header, models/{id}:generateContent
// path, and a contents/parts request shape entirely different from the
// OpenAI SDK's — not an OpenAI-compatible endpoint. system role becomes
// systemInstruction; assistant role maps to Gemini's "model" role.
async function callGemini({ messages, jsonMode, temperature = 0.3, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS }: ChatOptions) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

  const systemMessages = messages.filter((m) => m.role === "system");
  const turns = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    contents: turns.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      // Gemini's newer models "think" before answering by default, same
      // failure mode as Groq's gpt-oss — confirmed live: hidden thinking
      // tokens consumed the entire maxOutputTokens budget, returning a
      // response with no actual answer text at all. Disabling it entirely
      // leaves the full budget for the real JSON answer.
      thinkingConfig: { thinkingBudget: 0 },
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (systemMessages.length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }],
    };
  }

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!content) {
    throw new Error(`Empty response from Gemini: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return content;
}

async function callOpenAI({ messages, jsonMode, temperature = 0.3, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS }: ChatOptions) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");
  return content;
}

async function callOpenRouter({ messages, jsonMode, temperature = 0.3, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS }: ChatOptions) {
  const completion = await openrouter.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages,
    temperature,
    max_tokens: maxTokens,
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
// Gemini tried first — Groq (daily cap), OpenAI (zero quota), and
// OpenRouter (near-zero credit) were all exhausted the same day, so
// putting Gemini last would mean paying its latency cost only after three
// guaranteed failures on every single call.
const PROVIDERS: Provider[] = [
  { name: "Gemini", call: callGemini },
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
