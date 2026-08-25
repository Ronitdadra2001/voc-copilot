import OpenAI from "openai";
import Groq from "groq-sdk";
import Firecrawl from "@mendable/firecrawl-js";
import { ApifyClient } from "apify-client";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// OpenRouter exposes an OpenAI-compatible API — reuse the OpenAI SDK, just
// pointed at OpenRouter's base URL with its own key.
export const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});
// Google's Gemini API exposes an OpenAI-compatible endpoint too — same
// reuse pattern as OpenRouter above. Free tier, no card required, and
// added specifically as a provider independent of Groq/OpenAI/OpenRouter's
// shared exhaustion (Groq's daily cap, OpenAI's zero quota, OpenRouter's
// near-zero credit balance were all hit the same day).
export const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});
export const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
export const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
