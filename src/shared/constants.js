(function initRitoConstants(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  Rito.DEFAULT_SETTINGS = {
    microphoneSensitivity: 0.25,
    commandLanguage: "en-US",
    continuousListening: true,
    commandActivationMode: "always",
    hotword: "",
    highContrast: false,
    debugMode: false,
    commandCooldownMs: 500,
    customCommands: [],
    aiIntentEnabled: true,
    aiModel: "llama-3.3-70b-versatile",
    aiRequestDebounceMs: 450,
    aiCacheTtlMs: 45000,
  };

  Rito.DEFAULT_RUNTIME_STATE = {
    mode: "commands",
    listening: false,
    lastCommandAt: 0,
  };

  Rito.COMMAND_MODES = {
    COMMANDS: "commands",
    DICTATION: "dictation",
  };

  Rito.ACTIVATION_MODES = {
    ALWAYS: "always",
    WAKE_PHRASE: "wake_phrase",
  };

  Rito.DEFAULT_WAKE_PHRASE = "hey rito";

  // Common ASR variants that sound like "hey rito".
  Rito.WAKE_PHRASE_ALIASES = [
    "hey rito",
    "hello rito",
    "hello rto",
    "hello rita",
    "hello ritu",
    "helo rito",
    "hullo rito",
    "hellorito",
    "hay rito",
    "hei rito",
    "hey ritu",
    "hey rituh",
    "hey rto",
    "heyrito",
    "herito",
    "hy rto",
    "hey rido",
    "hey redo",
    "hey rta",
    "hey rita",
    "hy rito",
    "hyrita",
    "heyrita",
    "heyrto",
    "hey arto",
    "hey reto",
    "hey retoh",
    "hey reeto",
    "hey reedo",
    "hey reeta",
    "hey ritoo",
    "hey ritoh",
  ];

  Rito.PUNCTUATION_WORDS = {
    comma: ",",
    period: ".",
    "full stop": ".",
    "question mark": "?",
    "exclamation mark": "!",
    colon: ":",
    semicolon: ";",
    "open quote": '"',
    "close quote": '"',
    quote: '"',
    apostrophe: "'",
  };

  Rito.INTERACTIVE_SELECTORS = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[aria-expanded]",
    "[tabindex]:not([tabindex='-1'])",
    "[onclick]",
    "[data-toggle='collapse']",
    "[contenteditable='true']",
  ];

  Rito.STORAGE_KEYS = {
    SETTINGS: "rito.settings",
    RUNTIME_STATE: "rito.runtimeState",
    AI_CONFIG: "rito.aiConfig",
  };

  Rito.MESSAGE_TYPES = {
    GET_SETTINGS: "RITO_GET_SETTINGS",
    UPDATE_SETTINGS: "RITO_UPDATE_SETTINGS",
    SETTINGS_UPDATED: "RITO_SETTINGS_UPDATED",
    GET_RUNTIME_STATE: "RITO_GET_RUNTIME_STATE",
    UPDATE_RUNTIME_STATE: "RITO_UPDATE_RUNTIME_STATE",
    GET_AI_CONFIG: "RITO_GET_AI_CONFIG",
    UPDATE_AI_CONFIG: "RITO_UPDATE_AI_CONFIG",
    AI_PARSE_INTENT: "RITO_AI_PARSE_INTENT",
    AI_SUMMARIZE_PAGE: "RITO_AI_SUMMARIZE_PAGE",
    BROWSER_COMMAND: "RITO_BROWSER_COMMAND",
    GET_STATUS: "RITO_GET_STATUS",
    SET_LISTENING: "RITO_SET_LISTENING",
    SET_MODE: "RITO_SET_MODE",
    EXECUTE_COMMAND: "RITO_EXECUTE_COMMAND",
    SHOW_NUMBERS: "RITO_SHOW_NUMBERS",
    HIDE_NUMBERS: "RITO_HIDE_NUMBERS",
    PING: "RITO_PING",
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
