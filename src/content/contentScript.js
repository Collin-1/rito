(function initRitoContentScript(globalScope) {
  const root = globalScope || globalThis;

  if (root.__ritoContentInitialized) {
    return;
  }
  root.__ritoContentInitialized = true;

  const logger = Rito.createLogger("content");

  let currentSettings = Object.assign({}, Rito.DEFAULT_SETTINGS);
  let runtimeState = Object.assign({}, Rito.DEFAULT_RUNTIME_STATE);
  let speechEngine;
  let commandParser;
  let domNavigator;
  let overlayUI;
  let commandExecutor;
  let orbInjector;
  let unsubscribeSettings;
  let lastWakeHintAt = 0;

  async function requestBackground(type, payload) {
    try {
      const response = await chrome.runtime.sendMessage({
        type,
        payload: payload || {},
      });

      if (!response || !response.ok) {
        throw new Error(
          (response && response.error) || "Background request failed",
        );
      }

      return response.data;
    } catch (error) {
      logger.debug("Background request failed", { type, error });
      return null;
    }
  }

  function getSettings() {
    return currentSettings;
  }

  function getPageContext(maxChars) {
    const limit = Math.max(300, Number(maxChars || 2000));
    const url = String(
      root.location && root.location.href ? root.location.href : "",
    );
    const title = String(
      root.document && root.document.title ? root.document.title : "",
    );
    const textSource =
      (root.document && root.document.body && root.document.body.innerText) ||
      "";

    return {
      url,
      title,
      visibleText: String(textSource).slice(0, limit),
    };
  }

  function mapAiStepToCommand(step, pageContext) {
    if (!step || typeof step !== "object") {
      return null;
    }

    const action = String(step.action || "")
      .trim()
      .toUpperCase();

    switch (action) {
      case "OPEN_URL": {
        const target = String(
          step.url || step.target || step.value || "",
        ).trim();
        return {
          scope: "browser",
          action: "OPEN_URL",
          target,
          newTab: Boolean(step.newTab),
        };
      }

      case "SEARCH": {
        const query = String(
          step.query || step.value || step.target || "",
        ).trim();
        if (!query) {
          return null;
        }
        return {
          scope: "browser",
          action: "SEARCH",
          query,
        };
      }

      case "CLICK": {
        const target = String(step.target || step.value || "").trim();
        const numericTarget = Number(
          step.index !== undefined ? step.index : target,
        );
        if (Number.isInteger(numericTarget) && numericTarget >= 1) {
          return { action: "clickNumber", index: numericTarget };
        }
        if (!target) {
          return null;
        }
        return { action: "click", target };
      }

      case "SCROLL": {
        const directionSource = String(
          step.direction || step.target || "down",
        ).toLowerCase();
        const direction = directionSource.includes("up") ? "up" : "down";
        let amount = Number(step.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          amount = Number(step.value);
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          amount = Math.max(200, Math.round(root.innerHeight * 0.8));
        }

        return {
          action: "scroll",
          direction,
          amount: Math.round(amount),
        };
      }

      case "TYPE": {
        const text = String(step.value || step.target || "");
        if (!text.trim()) {
          return null;
        }
        return { action: "type", text };
      }

      case "SWITCH_TAB": {
        const target = String(step.target || step.value || "").trim();
        const numericTarget = Number(
          step.index !== undefined ? step.index : target,
        );

        if (Number.isInteger(numericTarget) && numericTarget >= 1) {
          return {
            scope: "browser",
            action: "GO_TO_TAB_INDEX",
            index: numericTarget,
          };
        }

        if (target) {
          return {
            scope: "browser",
            action: "SWITCH_TAB_TITLE",
            title: target,
          };
        }

        return { scope: "browser", action: "NEXT_TAB" };
      }

      case "CLOSE_TAB":
        return { scope: "browser", action: "CLOSE_TAB" };

      case "SUMMARIZE_PAGE":
        return {
          action: "summarizePage",
          context: pageContext || getPageContext(2000),
        };

      case "FIND_TOPIC": {
        const target = String(
          step.target || step.query || step.value || "",
        ).trim();
        if (!target) {
          return null;
        }
        return {
          action: "findTopic",
          target,
        };
      }

      default:
        return null;
    }
  }

  function mapAiIntentToCommand(intent, pageContext) {
    if (!intent || typeof intent !== "object") {
      return null;
    }

    const action = String(intent.action || "")
      .trim()
      .toUpperCase();
    if (action === "MULTI_STEP") {
      const steps = Array.isArray(intent.steps)
        ? intent.steps
            .map((step) => mapAiStepToCommand(step, pageContext))
            .filter(Boolean)
        : [];

      if (!steps.length) {
        return null;
      }

      return {
        action: "multiStep",
        steps,
      };
    }

    return mapAiStepToCommand(intent, pageContext);
  }

  async function persistRuntimeState(patch) {
    runtimeState = Object.assign({}, runtimeState, patch || {});
    try {
      const updated = await requestBackground(
        Rito.MESSAGE_TYPES.UPDATE_RUNTIME_STATE,
        runtimeState,
      );
      if (updated) {
        runtimeState = Object.assign({}, Rito.DEFAULT_RUNTIME_STATE, updated);
      }
    } catch (error) {
      logger.debug("Unable to persist runtime state", error);
    }
  }

  async function setMode(mode) {
    const nextMode =
      mode === Rito.COMMAND_MODES.DICTATION
        ? Rito.COMMAND_MODES.DICTATION
        : Rito.COMMAND_MODES.COMMANDS;
    runtimeState.mode = nextMode;
    speechEngine.setMode(nextMode);
    overlayUI.showFeedback(
      nextMode === Rito.COMMAND_MODES.DICTATION
        ? "Dictation mode enabled"
        : "Commands mode enabled",
      "info",
      1200,
    );
    if (orbInjector) {
      orbInjector.setStateFromOrb(
        nextMode === Rito.COMMAND_MODES.DICTATION ? "speaking" : "listening",
      );
    }
    await persistRuntimeState({ mode: nextMode });
  }

  async function setListening(listening) {
    if (listening) {
      speechEngine.start();
    } else {
      speechEngine.stop();
    }
    await persistRuntimeState({ listening: Boolean(listening) });
  }

  async function handleTranscript(text, confidence) {
    let command = commandParser.parse(text, { mode: runtimeState.mode });

    if (command && command.action === "summarizePage") {
      // Summary requests must always use the active page content.
      command = Object.assign({}, command, {
        context: getPageContext(2000),
      });
    }

    if (!command || command.action === "unknown") {
      overlayUI.showFeedback("Command not recognized", "warning", 1300);
      return;
    }

    logger.debug("Parsed command", command, { confidence });
    await commandExecutor.execute(command, {
      onModeChange: (nextMode) => {
        setMode(nextMode);
      },
      onListeningChange: (nextListening) => {
        setListening(nextListening);
      },
    });
    await persistRuntimeState({ lastCommandAt: Date.now() });
  }

  function wireSpeechEvents() {
    speechEngine.addEventListener("interim-transcript", (event) => {
      overlayUI.showTranscript(event.detail.text, true);
    });

    speechEngine.addEventListener("final-transcript", (event) => {
      overlayUI.showTranscript(event.detail.text, false);
      handleTranscript(event.detail.text, event.detail.confidence).catch(
        (error) => {
          logger.error("Failed to execute transcript", error);
          overlayUI.showFeedback("Could not execute command", "error", 1400);
        },
      );
    });

    speechEngine.addEventListener("hotword", () => {
      overlayUI.showFeedback(
        "Hotword heard. Listening for command.",
        "info",
        1000,
      );
    });

    speechEngine.addEventListener("ignored", (event) => {
      if (event.detail.reason === "hotword_required") {
        const now = Date.now();
        const wakeMode =
          String(currentSettings.commandActivationMode || "always") ===
          String(
            (Rito.ACTIVATION_MODES && Rito.ACTIVATION_MODES.WAKE_PHRASE) ||
              "wake_phrase",
          );

        if (wakeMode && now - lastWakeHintAt > 6000) {
          overlayUI.showFeedback(
            'Wake phrase mode is on. Say "hey rito" first.',
            "info",
            1300,
          );
          lastWakeHintAt = now;
        }
      }
    });

    speechEngine.addEventListener("error", (event) => {
      const code = event.detail.code;
      if (code === "not-allowed") {
        overlayUI.showFeedback("Microphone permission denied", "error", 2200);
      } else if (code === "audio-capture") {
        overlayUI.showFeedback("No microphone input detected", "warning", 2000);
      } else if (code === "unsupported") {
        overlayUI.showFeedback(
          "Speech recognition not supported on this page",
          "error",
          2500,
        );
      } else {
        overlayUI.showFeedback(
          "Speech engine hiccup detected",
          "warning",
          1200,
        );
      }
    });

    speechEngine.addEventListener("listening-state", (event) => {
      const listening = Boolean(event.detail.listening);
      runtimeState.listening = listening;
      persistRuntimeState({ listening });
      if (orbInjector) {
        orbInjector.setStateFromOrb(listening ? "listening" : "idle");
      }
    });

    speechEngine.addEventListener("audio-level", (event) => {
      const level = event.detail.level || 0;
      if (level > 10) {
        overlayUI.showFeedback(`Microphone active (${level}%)`, "info", 500);
      }
    });
  }

  function wireMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const type = message && message.type;
      const payload = (message && message.payload) || {};

      (async () => {
        switch (type) {
          case Rito.MESSAGE_TYPES.GET_STATUS:
            sendResponse({
              ok: true,
              data: {
                mode: runtimeState.mode,
                listening: runtimeState.listening,
                hotword: currentSettings.hotword,
              },
            });
            return;

          case Rito.MESSAGE_TYPES.SET_LISTENING:
            await setListening(Boolean(payload.listening));
            sendResponse({ ok: true });
            return;

          case Rito.MESSAGE_TYPES.SET_MODE:
            await setMode(payload.mode);
            sendResponse({ ok: true });
            return;

          case Rito.MESSAGE_TYPES.EXECUTE_COMMAND:
            await handleTranscript(String(payload.transcript || ""), 1);
            sendResponse({ ok: true });
            return;

          case Rito.MESSAGE_TYPES.SHOW_NUMBERS:
            await commandExecutor.execute({ action: "showNumbers" }, {});
            sendResponse({ ok: true });
            return;

          case Rito.MESSAGE_TYPES.HIDE_NUMBERS:
            await commandExecutor.execute({ action: "hideNumbers" }, {});
            sendResponse({ ok: true });
            return;

          case Rito.MESSAGE_TYPES.SETTINGS_UPDATED:
            currentSettings = Object.assign(
              {},
              Rito.DEFAULT_SETTINGS,
              payload || {},
            );
            logger.setDebugEnabled(Boolean(currentSettings.debugMode));
            commandParser.updateSettings(currentSettings);
            overlayUI.applySettings(currentSettings);
            speechEngine.updateSettings(currentSettings);
            sendResponse({ ok: true });
            return;

          default:
            sendResponse({ ok: false, error: "Unsupported message type" });
        }
      })().catch((error) => {
        logger.error("Message handling failed", error);
        sendResponse({
          ok: false,
          error: error.message || "Unknown content script error",
        });
      });

      return true;
    });
  }

  async function initialize() {
    const settingsFromBackground = await requestBackground(
      Rito.MESSAGE_TYPES.GET_SETTINGS,
    );
    const runtimeFromBackground = await requestBackground(
      Rito.MESSAGE_TYPES.GET_RUNTIME_STATE,
    );

    if (settingsFromBackground || runtimeFromBackground) {
      currentSettings = Object.assign(
        {},
        Rito.DEFAULT_SETTINGS,
        settingsFromBackground || {},
      );
      runtimeState = Object.assign(
        {},
        Rito.DEFAULT_RUNTIME_STATE,
        runtimeFromBackground || {},
      );
    } else {
      logger.warn("Falling back to defaults (background storage unavailable)");
      currentSettings = Object.assign({}, Rito.DEFAULT_SETTINGS);
      runtimeState = Object.assign({}, Rito.DEFAULT_RUNTIME_STATE);
    }

    logger.setDebugEnabled(Boolean(currentSettings.debugMode));

    overlayUI = new Rito.OverlayUI({ settings: currentSettings, logger });
    orbInjector = new Rito.OrbInjector({ settings: currentSettings, logger });
    orbInjector.inject();

    domNavigator = new Rito.DOMNavigator({ logger });
    commandParser = new Rito.CommandParser({
      settings: currentSettings,
      logger,
    });
    speechEngine = new Rito.SpeechEngine({ settings: currentSettings, logger });
    commandExecutor = new Rito.CommandExecutor({
      logger,
      domNavigator,
      overlayUI,
      getSettings,
    });

    speechEngine.setMode(runtimeState.mode || Rito.COMMAND_MODES.COMMANDS);
    wireSpeechEvents();
    wireMessages();

    unsubscribeSettings = null;

    if (currentSettings.continuousListening || runtimeState.listening) {
      await setListening(true);
    }

    // Setup tab focus listener after initialization completes
    let wasListeningBeforeHidden = false;

    // Use visibilitychange event for reliable tab focus detection
    root.document.addEventListener("visibilitychange", () => {
      if (root.document.hidden) {
        // Tab is now hidden - pause microphone
        if (runtimeState.listening && speechEngine) {
          logger.debug("Tab hidden, stopping microphone completely");
          wasListeningBeforeHidden = true;
          speechEngine.stop();
          runtimeState.listening = false;
        } else {
          wasListeningBeforeHidden = false;
        }
      } else {
        // Tab is now visible - resume microphone if it was active
        if (
          wasListeningBeforeHidden &&
          speechEngine &&
          !runtimeState.listening
        ) {
          logger.debug("Tab visible again, resuming microphone");
          setListening(true).catch((error) => {
            logger.error(
              "Failed to resume listening when tab became visible",
              error,
            );
          });
        }
      }
    });
  }

  initialize().catch((error) => {
    logger.error("Rito failed to initialize in content script", error);
  });

  root.addEventListener("beforeunload", () => {
    if (speechEngine) {
      speechEngine.stop();
    }
    if (typeof unsubscribeSettings === "function") {
      unsubscribeSettings();
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
