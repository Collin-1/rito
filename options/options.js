(function initRitoOptions(globalScope) {
  const root = globalScope || globalThis;
  const STORAGE_KEY = root.Rito.STORAGE_KEYS.SETTINGS;
  const defaults = root.Rito.DEFAULT_SETTINGS;
  const AI_TIMEOUT_DEFAULT_MS = 12000;

  const form = root.document.getElementById("settingsForm");
  const saveStatus = root.document.getElementById("saveStatus");
  const listContainer = root.document.getElementById("customCommandsList");
  const addShortcutBtn = root.document.getElementById("addShortcutBtn");
  const resetBtn = root.document.getElementById("resetBtn");

  const languageEl = root.document.getElementById("commandLanguage");
  const sensitivityEl = root.document.getElementById("microphoneSensitivity");
  const sensitivityValueEl = root.document.getElementById(
    "microphoneSensitivityValue",
  );
  const continuousListeningEl = root.document.getElementById(
    "continuousListening",
  );
  const commandActivationModeEl = root.document.getElementById(
    "commandActivationMode",
  );
  const hotwordEl = root.document.getElementById("hotword");
  const highContrastEl = root.document.getElementById("highContrast");
  const debugModeEl = root.document.getElementById("debugMode");
  const commandCooldownMsEl = root.document.getElementById("commandCooldownMs");
  const aiIntentEnabledEl = root.document.getElementById("aiIntentEnabled");
  const aiModelEl = root.document.getElementById("aiModel");
  const aiApiKeyEl = root.document.getElementById("aiApiKey");
  const clearApiKeyBtn = root.document.getElementById("clearApiKeyBtn");
  const apiKeyStateEl = root.document.getElementById("apiKeyState");
  const aiTimeoutMsEl = root.document.getElementById("aiTimeoutMs");
  const aiRequestDebounceMsEl = root.document.getElementById(
    "aiRequestDebounceMs",
  );
  const aiCacheTtlMsEl = root.document.getElementById("aiCacheTtlMs");

  let clearApiKeyRequested = false;
  let loadedAiConfig = {
    hasApiKey: false,
    maskedApiKey: "",
    timeoutMs: AI_TIMEOUT_DEFAULT_MS,
  };

  function setSaveStatus(message, durationMs) {
    saveStatus.textContent = message;
    if (!durationMs) {
      return;
    }
    clearTimeout(setSaveStatus.timer);
    setSaveStatus.timer = setTimeout(() => {
      saveStatus.textContent = "";
    }, durationMs);
  }

  function renderCustomCommands(customCommands) {
    listContainer.innerHTML = "";
    (customCommands || []).forEach((entry) => {
      listContainer.appendChild(createRow(entry.phrase, entry.command));
    });

    if (!customCommands || !customCommands.length) {
      listContainer.appendChild(createRow("", ""));
    }
  }

  function createRow(phrase, command) {
    const row = root.document.createElement("div");
    row.className = "command-row";

    const phraseInput = root.document.createElement("input");
    phraseInput.type = "text";
    phraseInput.placeholder = "Spoken phrase";
    phraseInput.value = phrase || "";
    phraseInput.dataset.role = "phrase";

    const commandInput = root.document.createElement("input");
    commandInput.type = "text";
    commandInput.placeholder = "Mapped command";
    commandInput.value = command || "";
    commandInput.dataset.role = "command";

    const removeButton = root.document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost-btn";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      row.remove();
      if (!listContainer.children.length) {
        listContainer.appendChild(createRow("", ""));
      }
    });

    row.appendChild(phraseInput);
    row.appendChild(commandInput);
    row.appendChild(removeButton);

    return row;
  }

  function readCustomCommands() {
    const rows = Array.from(listContainer.querySelectorAll(".command-row"));
    return rows
      .map((row) => {
        const phrase = row.querySelector("[data-role='phrase']").value.trim();
        const command = row.querySelector("[data-role='command']").value.trim();
        return { phrase, command };
      })
      .filter((entry) => entry.phrase && entry.command);
  }

  function applyToForm(settings) {
    const merged = Object.assign({}, defaults, settings || {});
    languageEl.value = merged.commandLanguage;
    sensitivityEl.value = String(merged.microphoneSensitivity);
    sensitivityValueEl.textContent = String(merged.microphoneSensitivity);
    continuousListeningEl.checked = Boolean(merged.continuousListening);
    commandActivationModeEl.value =
      merged.commandActivationMode === "wake_phrase"
        ? "wake_phrase"
        : defaults.commandActivationMode;
    if (hotwordEl) {
      hotwordEl.value = merged.hotword || "";
    }
    highContrastEl.checked = Boolean(merged.highContrast);
    debugModeEl.checked = Boolean(merged.debugMode);
    commandCooldownMsEl.value = String(merged.commandCooldownMs);
    aiIntentEnabledEl.checked = Boolean(merged.aiIntentEnabled);
    aiModelEl.value = merged.aiModel || defaults.aiModel;
    aiRequestDebounceMsEl.value = String(merged.aiRequestDebounceMs);
    aiCacheTtlMsEl.value = String(merged.aiCacheTtlMs);
    renderCustomCommands(merged.customCommands || []);
  }

  function renderApiKeyState() {
    if (clearApiKeyRequested) {
      apiKeyStateEl.textContent =
        "Saved API key will be removed when settings are saved.";
      return;
    }

    const typed = aiApiKeyEl.value.trim();
    if (typed) {
      apiKeyStateEl.textContent =
        "A new API key will replace the saved key when settings are saved.";
      return;
    }

    if (loadedAiConfig.hasApiKey) {
      const suffix = loadedAiConfig.maskedApiKey
        ? ` (${loadedAiConfig.maskedApiKey})`
        : "";
      apiKeyStateEl.textContent = `Saved API key detected${suffix}. Leave key input blank to keep it.`;
      return;
    }

    apiKeyStateEl.textContent =
      "No API key is saved. Add one to enable AI actions.";
  }

  function applyAiConfig(aiConfig) {
    loadedAiConfig = Object.assign(
      {},
      {
        hasApiKey: false,
        maskedApiKey: "",
        timeoutMs: AI_TIMEOUT_DEFAULT_MS,
      },
      aiConfig || {},
    );

    aiTimeoutMsEl.value = String(loadedAiConfig.timeoutMs);
    aiApiKeyEl.value = "";
    clearApiKeyRequested = false;
    renderApiKeyState();
  }

  async function requestBackground(type, payload) {
    try {
      const response = await chrome.runtime.sendMessage({
        type,
        payload: payload || {},
      });
      if (!response || !response.ok) {
        return null;
      }
      return response.data || null;
    } catch (_error) {
      return null;
    }
  }

  async function loadSettings() {
    const [settingsResult, aiConfig] = await Promise.all([
      chrome.storage.sync.get(STORAGE_KEY),
      requestBackground(root.Rito.MESSAGE_TYPES.GET_AI_CONFIG),
    ]);
    applyToForm(settingsResult[STORAGE_KEY]);
    applyAiConfig(aiConfig);
  }

  async function saveSettings(event) {
    event.preventDefault();

    const payload = {
      commandLanguage: languageEl.value,
      microphoneSensitivity: Number(sensitivityEl.value),
      continuousListening: continuousListeningEl.checked,
      commandActivationMode: commandActivationModeEl.value,
      highContrast: highContrastEl.checked,
      debugMode: debugModeEl.checked,
      commandCooldownMs: Number(commandCooldownMsEl.value),
      aiIntentEnabled: aiIntentEnabledEl.checked,
      aiModel: aiModelEl.value.trim() || defaults.aiModel,
      aiRequestDebounceMs: Number(aiRequestDebounceMsEl.value),
      aiCacheTtlMs: Number(aiCacheTtlMsEl.value),
      customCommands: readCustomCommands(),
    };

    if (hotwordEl) {
      payload.hotword = hotwordEl.value.trim();
    }

    const current = await chrome.storage.sync.get(STORAGE_KEY);
    const merged = Object.assign(
      {},
      defaults,
      current[STORAGE_KEY] || {},
      payload,
    );
    await chrome.storage.sync.set({ [STORAGE_KEY]: merged });

    try {
      await chrome.runtime.sendMessage({
        type: root.Rito.MESSAGE_TYPES.UPDATE_SETTINGS,
        payload: merged,
      });
    } catch (_error) {
      // The storage update still succeeds even if worker is asleep.
    }

    const typedKey = aiApiKeyEl.value.trim();
    const timeoutMs = Number(aiTimeoutMsEl.value);
    const normalizedTimeout = Number.isFinite(timeoutMs)
      ? timeoutMs
      : AI_TIMEOUT_DEFAULT_MS;
    const shouldUpdateAiConfig =
      clearApiKeyRequested ||
      Boolean(typedKey) ||
      normalizedTimeout !== Number(loadedAiConfig.timeoutMs);

    if (shouldUpdateAiConfig) {
      const aiPayload = {
        timeoutMs: normalizedTimeout,
      };

      if (clearApiKeyRequested) {
        aiPayload.clearApiKey = true;
      }

      if (typedKey) {
        aiPayload.apiKey = typedKey;
      }

      const updatedAiConfig = await requestBackground(
        root.Rito.MESSAGE_TYPES.UPDATE_AI_CONFIG,
        aiPayload,
      );

      if (updatedAiConfig) {
        applyAiConfig(updatedAiConfig);
      } else {
        setSaveStatus("Settings saved, but AI config update failed", 2200);
        return;
      }
    }

    setSaveStatus("Settings saved", 1600);
  }

  function wireEvents() {
    form.addEventListener("submit", saveSettings);

    sensitivityEl.addEventListener("input", () => {
      sensitivityValueEl.textContent = String(
        Number(sensitivityEl.value).toFixed(2),
      );
    });

    addShortcutBtn.addEventListener("click", () => {
      listContainer.appendChild(createRow("", ""));
    });

    clearApiKeyBtn.addEventListener("click", () => {
      clearApiKeyRequested = true;
      aiApiKeyEl.value = "";
      renderApiKeyState();
    });

    aiApiKeyEl.addEventListener("input", () => {
      if (aiApiKeyEl.value.trim()) {
        clearApiKeyRequested = false;
      }
      renderApiKeyState();
    });

    resetBtn.addEventListener("click", () => {
      applyToForm(defaults);
      aiTimeoutMsEl.value = String(AI_TIMEOUT_DEFAULT_MS);
      clearApiKeyRequested = false;
      aiApiKeyEl.value = "";
      renderApiKeyState();
      setSaveStatus("Defaults loaded. Save to apply.", 1800);
    });
  }

  wireEvents();
  loadSettings().catch(() => {
    applyToForm(defaults);
    applyAiConfig(null);
    setSaveStatus("Unable to load settings. Defaults shown.", 1800);
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
