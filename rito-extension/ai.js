// AI helpers for intent parsing, summarization, simplification, and key-point extraction.

import { safeJsonParse, truncateText } from "./utils.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

async function getApiKey() {
  const data = await chrome.storage.local.get(["openaiApiKey"]);
  const key = data.openaiApiKey;

  if (!key) {
    throw new Error("OpenAI API key not found. Add it in the popup first.");
  }

  return key;
}

async function callOpenAI(messages, options = {}) {
  const key = await getApiKey();

  const body = {
    model: options.model || DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 700,
  };

  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

export async function parseIntent(command) {
  const systemPrompt = `You are an intent parser for an accessibility voice browser assistant named Rito.
Return ONLY valid JSON.
No markdown, no extra keys unless useful.

You must:
1) Detect command language (English, Xitsonga, Zulu, Sepedi, or other).
2) Translate the command to English as english_command.
3) Choose one action from this list exactly:
   - open_site
   - search_site
   - summarize_page
   - read_page
   - simplify_page
   - scroll_page
   - click_element
   - highlight_important_points
   - unknown

JSON schema:
{
  "detected_language": "english|xitsonga|zulu|sepedi|other",
  "english_command": "translated command in english",
  "action": "one action above",
  "site": "optional website name",
  "query": "optional search query",
  "direction": "optional up|down|top|bottom",
  "label": "optional clickable label"
}`;

  const userPrompt = `User command: "${command}"`;

  const raw = await callOpenAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { responseFormat: { type: "json_object" }, temperature: 0 },
  );

  const parsed = safeJsonParse(raw) || {};

  return {
    detected_language: parsed.detected_language || "other",
    english_command: parsed.english_command || command,
    action: parsed.action || "unknown",
    site: parsed.site || "",
    query: parsed.query || "",
    direction: parsed.direction || "",
    label: parsed.label || "",
  };
}

export async function summarizeText(text) {
  const truncated = truncateText(text);

  const prompt = `Summarize this webpage content in 5 concise bullet points for a user with low digital literacy. Keep wording simple and practical.\n\n${truncated}`;

  return callOpenAI(
    [
      {
        role: "system",
        content: "You are an accessibility-focused summarizer.",
      },
      { role: "user", content: prompt },
    ],
    { temperature: 0.3, maxTokens: 450 },
  );
}

export async function simplifyText(text) {
  const truncated = truncateText(text);

  const prompt = `Rewrite this text so that a 10-year-old could understand it.
Use short sentences and clear language.
Keep all important meaning.

${truncated}`;

  return callOpenAI(
    [
      {
        role: "system",
        content: "You simplify text for accessibility and cognitive support.",
      },
      { role: "user", content: prompt },
    ],
    { temperature: 0.2, maxTokens: 900 },
  );
}

export async function extractKeySentences(text) {
  const truncated = truncateText(text);

  const prompt = `Pick 5 key sentences from this page that are most important.
Return ONLY JSON in this shape: {"sentences": ["...", "...", "...", "...", "..."]}

${truncated}`;

  const raw = await callOpenAI(
    [
      {
        role: "system",
        content: "You extract key information for assistive reading.",
      },
      { role: "user", content: prompt },
    ],
    {
      responseFormat: { type: "json_object" },
      temperature: 0.1,
      maxTokens: 350,
    },
  );

  const parsed = safeJsonParse(raw);

  if (!parsed || !Array.isArray(parsed.sentences)) {
    return [];
  }

  return parsed.sentences
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 5);
}
