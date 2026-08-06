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
export const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
export const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
