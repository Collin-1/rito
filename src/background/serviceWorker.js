importScripts(
  "../shared/constants.js",
  "../shared/logger.js",
  "../shared/storage.js",
  "../shared/fuzzy.js",
);

const logger = Rito.createLogger("background");
const browserActionTimestamps = new Map();

const KNOWN_SITES = {
  google: "google.com",
  youtube: "youtube.com",
  github: "github.com",
  reddit: "reddit.com",
  stackoverflow: "stackoverflow.com",
  stack: "stackoverflow.com",
  gmail: "mail.google.com",
  twitter: "x.com",
  x: "x.com",
};

async function initializeDefaults() {
  const currentSettings = await Rito.storage.getSettings();
  const merged = Object.assign({}, Rito.DEFAULT_SETTINGS, currentSettings);
  await chrome.storage.sync.set({ [Rito.STORAGE_KEYS.SETTINGS]: merged });
  logger.setDebugEnabled(Boolean(merged.debugMode));
}

async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          return undefined;
        }),
      ),
  );
}

function okResponse(message, data) {
  return {
    ok: true,
    message,
    data: data || null,
  };
}

function errorResponse(error) {
  return {
    ok: false,
    error,
  };
}

function getCommandCooldownMs() {
  return 250;
}

function shouldThrottleBrowserAction(action, sender) {
  const tabId =
    sender && sender.tab && Number.isInteger(sender.tab.id)
      ? sender.tab.id
      : "global";
  const key = `${tabId}:${action}`;
  const now = Date.now();
  const previous = browserActionTimestamps.get(key) || 0;

  if (now - previous < getCommandCooldownMs()) {
    return true;
  }

  browserActionTimestamps.set(key, now);
  return false;
}

async function getReferenceTab(sender) {
  if (sender && sender.tab && Number.isInteger(sender.tab.id)) {
    return sender.tab;
  }

  const [active] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return active || null;
}

async function getTabsInRelevantWindow(sender) {
  const reference = await getReferenceTab(sender);
  if (reference && Number.isInteger(reference.windowId)) {
    return chrome.tabs.query({ windowId: reference.windowId });
  }

  return chrome.tabs.query({ currentWindow: true });
}

function normalizeTarget(rawValue) {
  return String(rawValue || "")
    .trim()
    .replace(/^the\s+/i, "");
}

function isLikelyDomain(value) {
  return /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(value);
}

function buildSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function resolveUrlTarget(rawTarget) {
  const cleaned = normalizeTarget(rawTarget);
  const lowered = cleaned.toLowerCase();

  if (!cleaned) {
    return {
      url: "https://www.google.com",
      label: "Google",
      resolution: "default",
    };
  }

  if (/^https?:\/\//i.test(cleaned)) {
    return {
      url: cleaned,
      label: cleaned,
      resolution: "explicit_url",
    };
  }

  if (isLikelyDomain(lowered)) {
    return {
      url: `https://${lowered}`,
      label: lowered,
      resolution: "domain",
    };
  }

  if (!lowered.includes(" ") && /^[a-z0-9-]+$/i.test(lowered)) {
    const domain = KNOWN_SITES[lowered] || `${lowered}.com`;
    return {
      url: `https://${domain}`,
      label: domain,
      resolution: KNOWN_SITES[lowered] ? "known_site" : "single_token",
    };
  }

  return {
    url: buildSearchUrl(cleaned),
    label: cleaned,
    resolution: "search_fallback",
  };
}

async function activateTab(tab) {
  if (!tab || !Number.isInteger(tab.id)) {
    return errorResponse("No tab available to activate.");
  }

  await chrome.tabs.update(tab.id, { active: true });
  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  return okResponse(`Switched to ${tab.title || tab.url || "selected tab"}.`, {
    tabId: tab.id,
    windowId: tab.windowId,
  });
}

async function executeBrowserCommand(payload, sender) {
  const action = String((payload && payload.action) || "").trim();
  console.log("[Rito]", action, payload || {});
  logger.debug("Executing browser command", { action, payload });

  switch (action) {
    case "NEXT_TAB": {
      const tabs = await getTabsInRelevantWindow(sender);
      if (!tabs.length) {
        return errorResponse("No tabs available.");
      }

      const activeIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.active),
      );
      const nextIndex = (activeIndex + 1) % tabs.length;
      return activateTab(tabs[nextIndex]);
    }

    case "PREVIOUS_TAB": {
      const tabs = await getTabsInRelevantWindow(sender);
      if (!tabs.length) {
        return errorResponse("No tabs available.");
      }

      const activeIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.active),
      );
      const previousIndex = (activeIndex - 1 + tabs.length) % tabs.length;
      return activateTab(tabs[previousIndex]);
    }

    case "GO_TO_TAB_INDEX": {
      const requested = Number(payload && payload.index);
      const tabs = await getTabsInRelevantWindow(sender);
      if (!Number.isInteger(requested) || requested < 1) {
        return errorResponse("Tab index must be a positive number.");
      }

      if (requested > tabs.length) {
        return errorResponse(`Tab ${requested} does not exist in this window.`);
      }

      return activateTab(tabs[requested - 1]);
    }

    case "SWITCH_TAB_TITLE": {
      const titleHint = normalizeTarget(payload && payload.title);
      if (!titleHint) {
        return errorResponse("Say the tab name you want to switch to.");
      }

      const tabs = await getTabsInRelevantWindow(sender);
      if (!tabs.length) {
        return errorResponse("No tabs available.");
      }

      const ranked = tabs
        .map((tab) => {
          const combined = `${tab.title || ""} ${tab.url || ""}`.trim();
          return {
            tab,
            score: Rito.fuzzy.scoreCandidate(titleHint, combined),
          };
        })
        .sort((left, right) => right.score - left.score);

      const top = ranked[0];
      const second = ranked[1];
      if (!top || top.score < 0.2) {
        return errorResponse("No matching tab found.");
      }

      if (second && second.score > 0.35 && top.score - second.score < 0.07) {
        return errorResponse(
          "Multiple matching tabs found. Try saying a more specific tab name.",
        );
      }

      return activateTab(top.tab);
    }

    case "CLOSE_TAB": {
      const tab = await getReferenceTab(sender);
      if (!tab || !Number.isInteger(tab.id)) {
        return errorResponse("No active tab available to close.");
      }

      await chrome.tabs.remove(tab.id);
      return okResponse("Closed tab.", { tabId: tab.id });
    }

    case "DUPLICATE_TAB": {
      const tab = await getReferenceTab(sender);
      if (!tab || !Number.isInteger(tab.id)) {
        return errorResponse("No active tab available to duplicate.");
      }

      const duplicated = await chrome.tabs.duplicate(tab.id);
      return okResponse("Duplicated tab.", {
        tabId: duplicated && duplicated.id,
      });
    }

    case "OPEN_NEW_TAB": {
      const created = await chrome.tabs.create({});
      return okResponse("Opened new tab.", { tabId: created && created.id });
    }

    case "OPEN_NEW_WINDOW": {
      const createdWindow = await chrome.windows.create({});
      return okResponse("Opened new window.", {
        windowId: createdWindow && createdWindow.id,
      });
    }

    case "MOVE_TAB_TO_NEW_WINDOW": {
      const tab = await getReferenceTab(sender);
      if (!tab || !Number.isInteger(tab.id)) {
        return errorResponse("No active tab available to move.");
      }

      const createdWindow = await chrome.windows.create({ tabId: tab.id });
      return okResponse("Moved tab to a new window.", {
        windowId: createdWindow && createdWindow.id,
      });
    }

    case "OPEN_URL": {
      const resolution = resolveUrlTarget(payload && payload.target);
      const shouldOpenNewTab = Boolean(payload && payload.newTab);

      if (shouldOpenNewTab) {
        const created = await chrome.tabs.create({ url: resolution.url });
        return okResponse(`Opened ${resolution.label} in a new tab.`, {
          tabId: created && created.id,
          url: resolution.url,
          resolution: resolution.resolution,
        });
      }

      const tab = await getReferenceTab(sender);
      if (tab && Number.isInteger(tab.id)) {
        await chrome.tabs.update(tab.id, { url: resolution.url });
        return okResponse(`Opened ${resolution.label}.`, {
          tabId: tab.id,
          url: resolution.url,
          resolution: resolution.resolution,
        });
      }

      const created = await chrome.tabs.create({ url: resolution.url });
      return okResponse(`Opened ${resolution.label}.`, {
        tabId: created && created.id,
        url: resolution.url,
        resolution: resolution.resolution,
      });
    }

    case "SEARCH": {
      const query = normalizeTarget(payload && payload.query);
      if (!query) {
        return errorResponse("Search query is empty.");
      }

      const url = buildSearchUrl(query);
      const created = await chrome.tabs.create({ url });
      return okResponse(`Searching for ${query}.`, {
        tabId: created && created.id,
        query,
        url,
      });
    }

    case "GO_BACK": {
      const tab = await getReferenceTab(sender);
      if (!tab || !Number.isInteger(tab.id)) {
        return errorResponse("No active tab found.");
      }

      if (typeof chrome.tabs.goBack === "function") {
        await chrome.tabs.goBack(tab.id);
      } else {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            history.back();
          },
        });
      }

      return okResponse("Navigated back.", { tabId: tab.id });
    }

    case "GO_FORWARD": {
      const tab = await getReferenceTab(sender);
      if (!tab || !Number.isInteger(tab.id)) {
        return errorResponse("No active tab found.");
      }

      if (typeof chrome.tabs.goForward === "function") {
        await chrome.tabs.goForward(tab.id);
      } else {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            history.forward();
          },
        });
      }

      return okResponse("Navigated forward.", { tabId: tab.id });
    }

    case "REFRESH_TAB": {
      const tab = await getReferenceTab(sender);
      if (!tab || !Number.isInteger(tab.id)) {
        return errorResponse("No active tab found.");
      }

      await chrome.tabs.reload(tab.id);
      return okResponse("Refreshed page.", { tabId: tab.id });
    }

    default:
      return errorResponse(`Unsupported browser action: ${action}`);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeDefaults().catch((error) => {
    logger.error("Failed to initialize default settings.", error);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[Rito.STORAGE_KEYS.SETTINGS]) {
    return;
  }
  const updated = Object.assign(
    {},
    Rito.DEFAULT_SETTINGS,
    changes[Rito.STORAGE_KEYS.SETTINGS].newValue || {},
  );
  logger.setDebugEnabled(Boolean(updated.debugMode));
  broadcastToTabs({
    type: Rito.MESSAGE_TYPES.SETTINGS_UPDATED,
    payload: updated,
  }).catch((error) => {
    logger.warn("Unable to broadcast settings update.", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && message.type;
  const payload = (message && message.payload) || {};

  (async () => {
    switch (type) {
      case Rito.MESSAGE_TYPES.GET_SETTINGS: {
        const settings = await Rito.storage.getSettings();
        sendResponse({ ok: true, data: settings });
        return;
      }
      case Rito.MESSAGE_TYPES.UPDATE_SETTINGS: {
        const updated = await Rito.storage.saveSettings(payload);
        sendResponse({ ok: true, data: updated });
        return;
      }
      case Rito.MESSAGE_TYPES.GET_RUNTIME_STATE: {
        const runtimeState = await Rito.storage.getRuntimeState();
        sendResponse({ ok: true, data: runtimeState });
        return;
      }
      case Rito.MESSAGE_TYPES.UPDATE_RUNTIME_STATE: {
        const updated = await Rito.storage.saveRuntimeState(payload);
        sendResponse({ ok: true, data: updated });
        return;
      }
      case Rito.MESSAGE_TYPES.PING: {
        sendResponse({ ok: true, data: { alive: true } });
        return;
      }
      case Rito.MESSAGE_TYPES.BROWSER_COMMAND: {
        const action = String(payload.action || "");
        if (!action) {
          sendResponse(errorResponse("Missing browser action."));
          return;
        }

        if (shouldThrottleBrowserAction(action, _sender)) {
          sendResponse(
            errorResponse(
              "Please wait a moment before repeating that command.",
            ),
          );
          return;
        }

        const result = await executeBrowserCommand(payload, _sender);
        sendResponse(result);
        return;
      }
      default: {
        sendResponse({ ok: false, error: "Unsupported message type." });
      }
    }
  })().catch((error) => {
    logger.error("Background message handling failed.", error);
    sendResponse({
      ok: false,
      error: error.message || "Unknown background error.",
    });
  });

  return true;
});
