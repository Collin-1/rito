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
  let unsubscribeSettings;

  function getSettings() {
    return currentSettings;
  }

  async function persistRuntimeState(patch) {
    runtimeState = Object.assign({}, runtimeState, patch || {});
    try {
      await Rito.storage.saveRuntimeState(runtimeState);
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
    const command = commandParser.parse(text, { mode: runtimeState.mode });
    if (!command) {
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
        overlayUI.showFeedback("Say the hotword first", "warning", 1100);
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
    try {
      currentSettings = await Rito.storage.getSettings();
      runtimeState = await Rito.storage.getRuntimeState();
    } catch (error) {
      logger.warn("Falling back to defaults", error);
      currentSettings = Object.assign({}, Rito.DEFAULT_SETTINGS);
      runtimeState = Object.assign({}, Rito.DEFAULT_RUNTIME_STATE);
    }

    logger.setDebugEnabled(Boolean(currentSettings.debugMode));

    overlayUI = new Rito.OverlayUI({ settings: currentSettings, logger });
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

    unsubscribeSettings = Rito.storage.onSettingsChanged((nextSettings) => {
      currentSettings = nextSettings;
      logger.setDebugEnabled(Boolean(currentSettings.debugMode));
      commandParser.updateSettings(currentSettings);
      overlayUI.applySettings(currentSettings);
      speechEngine.updateSettings(currentSettings);
    });

    if (currentSettings.continuousListening || runtimeState.listening) {
      await setListening(true);
    }
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
