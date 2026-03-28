(function initRitoCommandParser(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  class CommandParser {
    constructor(options) {
      const opts = options || {};
      this.logger = opts.logger || Rito.createLogger("parser");
      this.customCommands =
        (opts.settings && opts.settings.customCommands) || [];
    }

    updateSettings(settings) {
      this.customCommands = (settings && settings.customCommands) || [];
    }

    parse(transcript, context) {
      const rawText = String(transcript || "").trim();
      if (!rawText) {
        return null;
      }

      const mode = (context && context.mode) || Rito.COMMAND_MODES.COMMANDS;
      const normalized = Rito.fuzzy.normalizeText(rawText);

      const custom = this._parseCustom(rawText, normalized);
      if (custom) {
        return custom;
      }

      const modeSwitch = this._parseModeSwitch(rawText, normalized);
      if (modeSwitch) {
        return modeSwitch;
      }

      if (mode === Rito.COMMAND_MODES.DICTATION) {
        return this._parseDictation(rawText, normalized);
      }

      return this._parseCommand(rawText, normalized);
    }

    _parseCustom(rawText, normalized) {
      const match = this.customCommands.find((entry) => {
        const phrase = Rito.fuzzy.normalizeText(entry && entry.phrase);
        if (!phrase) {
          return false;
        }
        return normalized === phrase;
      });

      if (!match || !match.command) {
        return null;
      }

      const rewritten = String(match.command).trim();
      if (!rewritten) {
        return null;
      }

      this.logger.debug("Custom command matched", {
        from: rawText,
        to: rewritten,
      });
      return this.parse(rewritten, { mode: Rito.COMMAND_MODES.COMMANDS });
    }

    _parseModeSwitch(rawText, normalized) {
      if (
        normalized === "start dictation" ||
        normalized === "dictation mode" ||
        normalized === "switch to dictation"
      ) {
        return {
          action: "setMode",
          mode: Rito.COMMAND_MODES.DICTATION,
          rawText,
        };
      }

      if (
        normalized === "stop dictation" ||
        normalized === "commands mode" ||
        normalized === "switch to commands"
      ) {
        return {
          action: "setMode",
          mode: Rito.COMMAND_MODES.COMMANDS,
          rawText,
        };
      }

      if (
        normalized === "start listening" ||
        normalized === "resume listening"
      ) {
        return {
          action: "setListening",
          listening: true,
          rawText,
        };
      }

      if (normalized === "stop listening" || normalized === "pause listening") {
        return {
          action: "setListening",
          listening: false,
          rawText,
        };
      }

      return null;
    }

    _parseCommand(rawText, normalized) {
      const browserCommand = this._parseBrowserCommand(rawText, normalized);
      if (browserCommand) {
        return browserCommand;
      }

      const scrollMatch = normalized.match(
        /^(?:scroll|go)\s+(down|up)(?:\s+(\d+))?(?:\s*(?:px|pixels))?$/,
      );
      if (scrollMatch) {
        return {
          action: "scroll",
          direction: scrollMatch[1],
          amount: Number(scrollMatch[2] || 400),
          rawText,
        };
      }

      if (normalized === "page down") {
        return {
          action: "scroll",
          direction: "down",
          amount: Math.round(root.innerHeight * 0.8),
          rawText,
        };
      }

      if (normalized === "page up") {
        return {
          action: "scroll",
          direction: "up",
          amount: Math.round(root.innerHeight * 0.8),
          rawText,
        };
      }

      if (normalized === "go back" || normalized === "back") {
        return { action: "goBack", rawText };
      }

      if (normalized === "go forward" || normalized === "forward") {
        return { action: "goForward", rawText };
      }

      if (
        normalized === "refresh page" ||
        normalized === "refresh" ||
        normalized === "reload"
      ) {
        return { action: "refresh", rawText };
      }

      if (
        normalized === "show numbers" ||
        normalized === "show hints" ||
        normalized === "show labels"
      ) {
        return { action: "showNumbers", rawText };
      }

      if (
        normalized === "hide numbers" ||
        normalized === "hide hints" ||
        normalized === "hide labels"
      ) {
        return { action: "hideNumbers", rawText };
      }

      const clickNumberMatch = normalized.match(
        /^(?:click|press|open|select)(?:\s+(?:item|number|link))?\s+(\d+)$/,
      );
      if (clickNumberMatch) {
        return {
          action: "clickNumber",
          index: Number(clickNumberMatch[1]),
          rawText,
        };
      }

      if (normalized === "select first result") {
        return {
          action: "selectFirstResult",
          target: "result",
          rawText,
        };
      }

      const openNewTabMatch = rawText.match(
        /^(?:open|launch)\s+(.+?)\s+in\s+(?:a\s+)?new\s+tab$/i,
      );
      if (openNewTabMatch) {
        return {
          action: "openInNewTab",
          target: openNewTabMatch[1].trim(),
          rawText,
        };
      }

      if (normalized === "open link in new tab") {
        return {
          action: "openInNewTab",
          target: "",
          rawText,
        };
      }

      const clickTargetMatch = rawText.match(
        /^(?:click|press|open|select)\s+(.+)$/i,
      );
      if (clickTargetMatch) {
        return {
          action: "click",
          target: clickTargetMatch[1].trim(),
          rawText,
        };
      }

      const fillFieldMatch = rawText.match(
        /^(?:enter|type|write)\s+(.+?)\s+in\s+(.+)$/i,
      );
      if (fillFieldMatch) {
        return {
          action: "fillField",
          text: fillFieldMatch[1].trim(),
          fieldHint: fillFieldMatch[2].trim(),
          rawText,
        };
      }

      const enterEmailMatch = rawText.match(/^enter\s+email\s+(.+)$/i);
      if (enterEmailMatch) {
        return {
          action: "fillField",
          text: enterEmailMatch[1].trim(),
          fieldHint: "email",
          rawText,
        };
      }

      const typeMatch = rawText.match(/^(?:type|enter|write)\s+(.+)$/i);
      if (typeMatch) {
        return {
          action: "type",
          text: typeMatch[1],
          rawText,
        };
      }

      if (normalized === "submit" || normalized === "press submit") {
        return {
          action: "click",
          target: "submit",
          rawText,
        };
      }

      if (normalized === "open menu") {
        return {
          action: "click",
          target: "menu",
          rawText,
        };
      }

      const fallbackIntent = this._inferFallbackIntent(rawText, normalized);
      if (fallbackIntent) {
        return fallbackIntent;
      }

      return {
        action: "unknown",
        rawText,
      };
    }

    _parseBrowserCommand(rawText, normalized) {
      if (normalized === "next tab" || normalized === "switch to next tab") {
        return {
          scope: "browser",
          action: "NEXT_TAB",
          rawText,
        };
      }

      if (
        normalized === "previous tab" ||
        normalized === "prev tab" ||
        normalized === "last tab" ||
        normalized === "switch to previous tab"
      ) {
        return {
          scope: "browser",
          action: "PREVIOUS_TAB",
          rawText,
        };
      }

      const goToTabIndexMatch = normalized.match(
        /^(?:go to|switch to)\s+tab\s+(\d+)$/,
      );
      if (goToTabIndexMatch) {
        return {
          scope: "browser",
          action: "GO_TO_TAB_INDEX",
          index: Number(goToTabIndexMatch[1]),
          rawText,
        };
      }

      const switchByTitleMatch = rawText.match(
        /^(?:switch to|go to)\s+(.+?)\s+tab$/i,
      );
      if (switchByTitleMatch) {
        return {
          scope: "browser",
          action: "SWITCH_TAB_TITLE",
          title: switchByTitleMatch[1].trim(),
          rawText,
        };
      }

      if (normalized === "close tab" || normalized === "close this tab") {
        return {
          scope: "browser",
          action: "CLOSE_TAB",
          rawText,
        };
      }

      if (normalized === "duplicate tab" || normalized === "clone tab") {
        return {
          scope: "browser",
          action: "DUPLICATE_TAB",
          rawText,
        };
      }

      if (normalized === "open new tab" || normalized === "new tab") {
        return {
          scope: "browser",
          action: "OPEN_NEW_TAB",
          rawText,
        };
      }

      if (normalized === "open new window" || normalized === "new window") {
        return {
          scope: "browser",
          action: "OPEN_NEW_WINDOW",
          rawText,
        };
      }

      if (
        normalized === "move tab to new window" ||
        normalized === "pop out tab" ||
        normalized === "move this tab to new window"
      ) {
        return {
          scope: "browser",
          action: "MOVE_TAB_TO_NEW_WINDOW",
          rawText,
        };
      }

      if (normalized === "go back" || normalized === "back") {
        return {
          scope: "browser",
          action: "GO_BACK",
          rawText,
        };
      }

      if (normalized === "go forward" || normalized === "forward") {
        return {
          scope: "browser",
          action: "GO_FORWARD",
          rawText,
        };
      }

      if (
        normalized === "refresh page" ||
        normalized === "refresh" ||
        normalized === "reload"
      ) {
        return {
          scope: "browser",
          action: "REFRESH_TAB",
          rawText,
        };
      }

      const searchMatch = rawText.match(
        /^(?:search for|find|look up)\s+(.+)$/i,
      );
      if (searchMatch) {
        return {
          scope: "browser",
          action: "SEARCH",
          query: searchMatch[1].trim(),
          rawText,
        };
      }

      const openInNewTabMatch = rawText.match(
        /^(?:open|go to)\s+(.+?)\s+in\s+(?:a\s+)?new\s+tab$/i,
      );
      if (openInNewTabMatch) {
        const target = openInNewTabMatch[1].trim();
        if (this._isUiElementIntent(target)) {
          return null;
        }

        return {
          scope: "browser",
          action: "OPEN_URL",
          target,
          newTab: true,
          rawText,
        };
      }

      const goToUrlMatch = rawText.match(/^go to\s+(.+)$/i);
      if (goToUrlMatch) {
        return {
          scope: "browser",
          action: "OPEN_URL",
          target: goToUrlMatch[1].trim(),
          rawText,
        };
      }

      const openTargetMatch = rawText.match(/^open\s+(.+)$/i);
      if (openTargetMatch) {
        const target = openTargetMatch[1].trim();
        if (this._isLikelyBrowserDestination(target)) {
          return {
            scope: "browser",
            action: "OPEN_URL",
            target,
            rawText,
          };
        }
      }

      return null;
    }

    _isLikelyBrowserDestination(rawTarget) {
      const target = Rito.fuzzy.normalizeText(rawTarget);
      if (!target) {
        return false;
      }

      if (this._isUiElementIntent(target)) {
        return false;
      }

      if (/^https?:\/\//.test(rawTarget)) {
        return true;
      }

      if (/^[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/.*)?$/i.test(target)) {
        return true;
      }

      if (target.includes(" ")) {
        return false;
      }

      return /^[a-z0-9-]+$/i.test(target);
    }

    _isUiElementIntent(rawTarget) {
      const target = Rito.fuzzy.normalizeText(rawTarget);
      const uiWords = new Set([
        "menu",
        "button",
        "submit",
        "settings",
        "dialog",
        "modal",
        "profile",
        "item",
        "link",
        "result",
      ]);
      return uiWords.has(target);
    }

    _inferFallbackIntent(rawText, normalized) {
      const tokens = new Set(normalized.split(" ").filter(Boolean));

      if (tokens.has("scroll") || tokens.has("down") || tokens.has("up")) {
        if (tokens.has("up")) {
          return {
            action: "scroll",
            direction: "up",
            amount: 350,
            rawText,
          };
        }
        if (tokens.has("down")) {
          return {
            action: "scroll",
            direction: "down",
            amount: 350,
            rawText,
          };
        }
      }

      if (tokens.has("back")) {
        return { scope: "browser", action: "GO_BACK", rawText };
      }

      if (tokens.has("forward")) {
        return { scope: "browser", action: "GO_FORWARD", rawText };
      }

      if (tokens.has("reload") || tokens.has("refresh")) {
        return { scope: "browser", action: "REFRESH_TAB", rawText };
      }

      if (tokens.has("numbers") || tokens.has("hints")) {
        if (tokens.has("hide")) {
          return { action: "hideNumbers", rawText };
        }
        return { action: "showNumbers", rawText };
      }

      const numberToken = Array.from(tokens).find((token) =>
        /^\d+$/.test(token),
      );
      if (
        (tokens.has("click") || tokens.has("open") || tokens.has("press")) &&
        numberToken
      ) {
        return {
          action: "clickNumber",
          index: Number(numberToken),
          rawText,
        };
      }

      return null;
    }

    _parseDictation(rawText, normalized) {
      if (normalized === "delete last word" || normalized === "undo word") {
        return {
          action: "deleteLastWord",
          rawText,
        };
      }

      if (
        normalized === "new line" ||
        normalized === "next line" ||
        normalized === "line break"
      ) {
        return {
          action: "insertNewLine",
          rawText,
        };
      }

      if (Rito.PUNCTUATION_WORDS[normalized]) {
        return {
          action: "dictate",
          text: Rito.PUNCTUATION_WORDS[normalized],
          appendSpace: true,
          rawText,
        };
      }

      const typeMatch = rawText.match(/^(?:type|enter|write)\s+(.+)$/i);
      if (typeMatch) {
        return {
          action: "dictate",
          text: typeMatch[1],
          appendSpace: true,
          rawText,
        };
      }

      return {
        action: "dictate",
        text: rawText,
        appendSpace: true,
        rawText,
      };
    }
  }

  Rito.CommandParser = CommandParser;
})(typeof globalThis !== "undefined" ? globalThis : window);
