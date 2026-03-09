// Action executor layer that bridges AI intent output and browser/content-script behavior.

import { extractKeySentences, simplifyText, summarizeText } from "./ai.js";
import {
  buildSearchUrl,
  getSiteUrl,
  openTab,
  sendMessageToActiveTab,
} from "./utils.js";

export async function open_site(site) {
  const target = String(site || "").trim();
  const url =
    getSiteUrl(target) ||
    (target ? `https://${target}` : "https://www.google.com");
  await openTab(url);
  return { ok: true, message: `Opened ${target || "Google"}.` };
}

export async function search_site(site, query) {
  const safeQuery = String(query || "").trim() || "accessibility";
  const searchUrl = buildSearchUrl(site, safeQuery);
  await openTab(searchUrl);
  return {
    ok: true,
    message: `Searching ${site || "the web"} for: ${safeQuery}`,
  };
}

export async function summarize_page() {
  const textResponse = await sendMessageToActiveTab({
    type: "EXTRACT_PAGE_TEXT",
  });
  const pageText = textResponse?.text || "";

  if (!pageText) {
    return { ok: false, message: "I could not read text from this page." };
  }

  const summary = await summarizeText(pageText);
  return { ok: true, message: summary, summary };
}

export async function read_page() {
  const result = await sendMessageToActiveTab({ type: "START_READING_PAGE" });
  return {
    ok: Boolean(result?.ok),
    message: result?.ok
      ? "Reading page aloud."
      : result?.message || "Could not start reading.",
  };
}

export async function simplify_page() {
  const textResponse = await sendMessageToActiveTab({
    type: "EXTRACT_PAGE_TEXT",
  });
  const pageText = textResponse?.text || "";

  if (!pageText) {
    return { ok: false, message: "I could not read text from this page." };
  }

  const simplified = await simplifyText(pageText);
  await sendMessageToActiveTab({
    type: "REPLACE_PAGE_CONTENT",
    text: simplified,
  });

  return {
    ok: true,
    message: "Replaced page with a simplified version.",
    simplified,
  };
}

export async function scroll_page(direction = "down") {
  const result = await sendMessageToActiveTab({
    type: "SCROLL_PAGE",
    direction,
  });
  return {
    ok: Boolean(result?.ok),
    message: result?.ok
      ? `Scrolled ${direction}.`
      : result?.message || "Could not scroll.",
  };
}

export async function click_element(label) {
  const result = await sendMessageToActiveTab({
    type: "FIND_AND_CLICK",
    label,
  });
  return {
    ok: Boolean(result?.ok),
    message: result?.ok
      ? `Clicked element: ${label}`
      : result?.message || `Could not find: ${label}`,
  };
}

export async function highlight_important_points() {
  const textResponse = await sendMessageToActiveTab({
    type: "EXTRACT_PAGE_TEXT",
  });
  const pageText = textResponse?.text || "";

  if (!pageText) {
    return { ok: false, message: "I could not read text from this page." };
  }

  const sentences = await extractKeySentences(pageText);

  if (!sentences.length) {
    return {
      ok: false,
      message: "I could not identify key points to highlight.",
    };
  }

  await sendMessageToActiveTab({ type: "HIGHLIGHT_SENTENCES", sentences });
  return { ok: true, message: "Highlighted important points on this page." };
}

export async function pauseReading() {
  await sendMessageToActiveTab({ type: "PAUSE_READING" });
  return { ok: true, message: "Paused reading." };
}

export async function resumeReading() {
  await sendMessageToActiveTab({ type: "RESUME_READING" });
  return { ok: true, message: "Resumed reading." };
}

export async function stopReading() {
  await sendMessageToActiveTab({ type: "STOP_READING" });
  return { ok: true, message: "Stopped reading." };
}

export function readTextAloud(text) {
  if (!text) {
    return { ok: false, message: "Nothing to read aloud." };
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);

  return { ok: true, message: "Reading response aloud." };
}

export async function executeAction(intent) {
  switch (intent.action) {
    case "open_site":
      return open_site(intent.site);
    case "search_site":
      return search_site(intent.site, intent.query);
    case "summarize_page":
      return summarize_page();
    case "read_page":
      return read_page();
    case "simplify_page":
      return simplify_page();
    case "scroll_page":
      return scroll_page(intent.direction || "down");
    case "click_element":
      return click_element(intent.label || "");
    case "highlight_important_points":
      return highlight_important_points();
    default:
      return {
        ok: false,
        message: `I understood: "${intent.english_command}" but I could not map it to a supported action.`,
      };
  }
}
