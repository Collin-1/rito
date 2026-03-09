// Shared utility helpers used across popup, AI, and action modules.

export const SITE_MAP = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  wikipedia: "https://www.wikipedia.org",
  github: "https://github.com",
  facebook: "https://www.facebook.com",
  x: "https://x.com",
  twitter: "https://x.com",
  linkedin: "https://www.linkedin.com",
};

export function normalizeSiteName(site = "") {
  return String(site).trim().toLowerCase();
}

export function getSiteUrl(site) {
  const normalized = normalizeSiteName(site);
  return SITE_MAP[normalized] || null;
}

export function buildSearchUrl(site, query) {
  const normalized = normalizeSiteName(site);
  const encoded = encodeURIComponent(query || "");

  if (normalized === "youtube") {
    return `https://www.youtube.com/results?search_query=${encoded}`;
  }

  if (normalized === "wikipedia") {
    return `https://en.wikipedia.org/w/index.php?search=${encoded}`;
  }

  if (normalized === "github") {
    return `https://github.com/search?q=${encoded}`;
  }

  if (normalized && SITE_MAP[normalized]) {
    return `${SITE_MAP[normalized]}/search?q=${encoded}`;
  }

  return `https://www.google.com/search?q=${encoded}`;
}

export function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function truncateText(text = "", maxLength = 12000) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n[Text truncated for MVP processing]`;
}

export async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

export async function openTab(url) {
  if (!url) {
    throw new Error("No URL provided.");
  }
  await chrome.tabs.create({ url });
}

export async function sendMessageToActiveTab(message) {
  const tab = await getActiveTab();

  if (!tab || !tab.id) {
    throw new Error("No active tab was found.");
  }

  return chrome.tabs.sendMessage(tab.id, message);
}
