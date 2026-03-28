(function initRitoConstants(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  Rito.DEFAULT_SETTINGS = {
    microphoneSensitivity: 0.4,
    commandLanguage: "en-US",
    continuousListening: true,
    hotword: "",
    highContrast: false,
    debugMode: false,
    commandCooldownMs: 500,
    customCommands: [],
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
    "[tabindex]:not([tabindex='-1'])",
    "[onclick]",
    "[contenteditable='true']",
  ];

  Rito.STORAGE_KEYS = {
    SETTINGS: "rito.settings",
    RUNTIME_STATE: "rito.runtimeState",
  };

  Rito.MESSAGE_TYPES = {
    GET_SETTINGS: "RITO_GET_SETTINGS",
    UPDATE_SETTINGS: "RITO_UPDATE_SETTINGS",
    SETTINGS_UPDATED: "RITO_SETTINGS_UPDATED",
    GET_RUNTIME_STATE: "RITO_GET_RUNTIME_STATE",
    UPDATE_RUNTIME_STATE: "RITO_UPDATE_RUNTIME_STATE",
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
