import OpenAI from "openai";
import Groq from "groq-sdk";
import { ApifyClient } from "apify-client";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// OpenRouter exposes an OpenAI-compatible API — reuse the OpenAI SDK, just
// pointed at OpenRouter's base URL with its own key.
export const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});
// Gemini does NOT use the OpenAI SDK — confirmed live via Google's own
// generated cURL quickstart for this exact key: it needs the native
// generativelanguage.googleapis.com REST API (X-goog-api-key header,
// contents/parts request shape), not an OpenAI-compatible endpoint. See
// callGemini in llm.ts, which calls this directly via fetch().
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
