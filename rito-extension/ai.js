// AI helpers for intent parsing, summarization, simplification, and key-point extraction.

import { safeJsonParse, truncateText } from "./utils.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.1-8b-instant";

const QUOTA_FALLBACK_NOTE =
  "Groq quota unavailable. Running local fallback mode with reduced AI quality.";

async function getApiKey() {
  const data = await chrome.storage.local.get(["groqApiKey"]);
  const key = String(data.groqApiKey || "").trim();

  if (!key) {
    throw new Error(
      "Groq API key not found. Save a valid gsk_ key in the popup.",
    );
  }

  if (!key.startsWith("gsk_")) {
    throw new Error("Invalid Groq key format. Groq keys start with gsk_.");
  }

  return key;
}

async function callGroq(messages, options = {}) {
  const key = await getApiKey();

  const body = {
    model: options.model || DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 700,
  };

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const parsed = safeJsonParse(errorText) || {};
    const type = parsed?.error?.type || "";
    const code = parsed?.error?.code || "";

    if (
      response.status === 429 ||
      type === "insufficient_quota" ||
      code === "rate_limit_exceeded"
    ) {
      const error = new Error("Groq quota exceeded.");
      error.name = "QuotaExceededError";
      throw error;
    }

    throw new Error(`Groq request failed: ${response.status} ${errorText}`);
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

  try {
    const raw = await callGroq(
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
      fallback_note: "",
    };
  } catch (error) {
    const fallback = parseIntentLocally(command);
    const reason = String(error?.message || "").slice(0, 180);
    return {
      ...fallback,
      fallback_note:
        error?.name === "QuotaExceededError"
          ? QUOTA_FALLBACK_NOTE
          : `Groq unavailable (${reason || "request failed"}). Running local fallback mode.`,
    };
  }
}

export async function summarizeText(text) {
  const truncated = truncateText(text);

  const prompt = `Summarize this webpage content in 5 concise bullet points for a user with low digital literacy. Keep wording simple and practical.\n\n${truncated}`;

  try {
    return await callGroq(
      [
        {
          role: "system",
          content: "You are an accessibility-focused summarizer.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.3, maxTokens: 450 },
    );
  } catch {
    return buildLocalSummary(text);
  }
}

export async function simplifyText(text) {
  const truncated = truncateText(text);

  const prompt = `Rewrite this text so that a 10-year-old could understand it.
Use short sentences and clear language.
Keep all important meaning.

${truncated}`;

  try {
    return await callGroq(
      [
        {
          role: "system",
          content: "You simplify text for accessibility and cognitive support.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.2, maxTokens: 900 },
    );
  } catch {
    return buildLocalSimplifiedText(text);
  }
}

export async function extractKeySentences(text) {
  const truncated = truncateText(text);

  const prompt = `Pick 5 key sentences from this page that are most important.
Return ONLY JSON in this shape: {"sentences": ["...", "...", "...", "...", "..."]}

${truncated}`;

  try {
    const raw = await callGroq(
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
  } catch {
    return pickImportantSentencesLocally(text);
  }
}

function parseIntentLocally(command) {
  const raw = String(command || "").trim();
  const lower = raw.toLowerCase();

  const siteNames = ["youtube", "google", "github", "wikipedia", "gmail"];

  if (/summarize|summary|sum up/.test(lower)) {
    return baseIntent(raw, "summarize_page");
  }

  if (/read (this|the)? ?(page|article)|read aloud|speak/.test(lower)) {
    return baseIntent(raw, "read_page");
  }

  if (/simplify|simple|explain .*simply|easy words/.test(lower)) {
    return baseIntent(raw, "simplify_page");
  }

  if (/highlight|important points|key points/.test(lower)) {
    return baseIntent(raw, "highlight_important_points");
  }

  if (/scroll/.test(lower)) {
    let direction = "down";
    if (/up/.test(lower)) direction = "up";
    if (/top/.test(lower)) direction = "top";
    if (/bottom|end/.test(lower)) direction = "bottom";
    return { ...baseIntent(raw, "scroll_page"), direction };
  }

  if (/click|tap|press/.test(lower)) {
    const label = raw.replace(/^(click|tap|press)\s+/i, "").trim();
    return { ...baseIntent(raw, "click_element"), label };
  }

  if (/search/.test(lower)) {
    const onMatch = lower.match(/search\s+(.+?)\s+(?:on|in)\s+([a-z0-9.-]+)/i);
    if (onMatch) {
      return {
        ...baseIntent(raw, "search_site"),
        query: onMatch[1],
        site: onMatch[2],
      };
    }

    const openAndSearch = lower.match(
      /open\s+([a-z0-9.-]+)\s+and\s+search\s+(.+)/i,
    );
    if (openAndSearch) {
      return {
        ...baseIntent(raw, "search_site"),
        site: openAndSearch[1],
        query: openAndSearch[2],
      };
    }

    const site = siteNames.find((name) => lower.includes(name)) || "google";
    const query = raw.replace(/.*search\s*/i, "").trim() || "accessibility";
    return { ...baseIntent(raw, "search_site"), site, query };
  }

  if (/open\s+/.test(lower)) {
    const openMatch = lower.match(/open\s+([a-z0-9.-]+)/i);
    return {
      ...baseIntent(raw, "open_site"),
      site: openMatch?.[1] || "google",
    };
  }

  return baseIntent(raw, "unknown");
}

function baseIntent(command, action) {
  return {
    detected_language: "other",
    english_command: command,
    action,
    site: "",
    query: "",
    direction: "",
    label: "",
  };
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
}

function buildLocalSummary(text) {
  const sentences = splitSentences(text).slice(0, 5);

  if (!sentences.length) {
    return "- Could not extract enough text for a summary.";
  }

  return [
    "[Local fallback summary - Groq unavailable]",
    ...sentences.map((line) => `- ${line}`),
  ].join("\n");
}

function buildLocalSimplifiedText(text) {
  const sentences = splitSentences(text).slice(0, 8);

  if (!sentences.length) {
    return "Simple version not available because the page text is too short.";
  }

  const shorter = sentences.map((line) => {
    const trimmed = line.length > 140 ? `${line.slice(0, 137)}...` : line;
    return trimmed;
  });

  return [
    "Simple version (local fallback):",
    ...shorter.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n\n");
}

function pickImportantSentencesLocally(text) {
  const sentences = splitSentences(text);

  return sentences
    .map((value, index) => ({ value, index, score: value.length - index * 2 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.value);
}
