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

      const scrollSpokenMatch = rawText.match(
        /^(?:scroll|go)\s+(down|up)\s+(.+?)(?:\s*(?:px|pixels))?$/i,
      );
      if (scrollSpokenMatch) {
        const spokenAmount = this._extractNumberValue(scrollSpokenMatch[2]);
        if (Number.isInteger(spokenAmount) && spokenAmount > 0) {
          return {
            action: "scroll",
            direction: String(scrollSpokenMatch[1]).toLowerCase(),
            amount: spokenAmount,
            rawText,
          };
        }
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

      const clickNumberMatch = rawText.match(
        /^(?:click|press|open|select)(?:\s+(?:item|number|link))?\s+(.+)$/i,
      );
      if (clickNumberMatch) {
        const clickIndex = this._extractNumberValue(clickNumberMatch[1]);
        if (Number.isInteger(clickIndex) && clickIndex >= 1) {
          return {
            action: "clickNumber",
            index: clickIndex,
            rawText,
          };
        }

        if (Rito.fuzzy.normalizeText(clickNumberMatch[1]) === "first") {
          return {
            action: "clickNumber",
            index: 1,
            rawText,
          };
        }
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

      const goToTabIndexMatch = rawText.match(
        /^(?:go to|switch to)\s+tab\s+(.+)$/i,
      );
      if (goToTabIndexMatch) {
        const tabIndex = this._extractNumberValue(goToTabIndexMatch[1]);
        if (Number.isInteger(tabIndex) && tabIndex >= 1) {
          return {
            scope: "browser",
            action: "GO_TO_TAB_INDEX",
            index: tabIndex,
            rawText,
          };
        }
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

      if (tokens.has("click") || tokens.has("open") || tokens.has("press")) {
        const spokenNumberMatch = rawText.match(
          /^(?:click|press|open|select)(?:\s+(?:item|number|link))?\s+(.+)$/i,
        );
        if (spokenNumberMatch) {
          const spokenIndex = this._extractNumberValue(spokenNumberMatch[1]);
          if (Number.isInteger(spokenIndex) && spokenIndex >= 1) {
            return {
              action: "clickNumber",
              index: spokenIndex,
              rawText,
            };
          }
        }
      }

      return null;
    }

    _extractNumberValue(rawInput) {
      const value = String(rawInput || "")
        .trim()
        .toLowerCase();
      if (!value) {
        return null;
      }

      const directNumberMatch = value.match(/\b(\d+)\b/);
      if (directNumberMatch) {
        return Number(directNumberMatch[1]);
      }

      const ordinalDigitMatch = value.match(/\b(\d+)(?:st|nd|rd|th)\b/);
      if (ordinalDigitMatch) {
        return Number(ordinalDigitMatch[1]);
      }

      const parsedWords = this._parseWordNumber(value);
      if (Number.isInteger(parsedWords)) {
        return parsedWords;
      }

      return null;
    }

    _parseWordNumber(rawInput) {
      const units = {
        zero: 0,
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
        thirteen: 13,
        fourteen: 14,
        fifteen: 15,
        sixteen: 16,
        seventeen: 17,
        eighteen: 18,
        nineteen: 19,
      };

      const tens = {
        twenty: 20,
        thirty: 30,
        forty: 40,
        fifty: 50,
        sixty: 60,
        seventy: 70,
        eighty: 80,
        ninety: 90,
      };

      const scales = {
        thousand: 1000,
        million: 1000000,
        billion: 1000000000,
        trillion: 1000000000000,
      };

      const ordinalAliases = {
        first: "one",
        second: "two",
        third: "three",
        fourth: "four",
        fifth: "five",
        sixth: "six",
        seventh: "seven",
        eighth: "eight",
        ninth: "nine",
        tenth: "ten",
        eleventh: "eleven",
        twelfth: "twelve",
        thirteenth: "thirteen",
        fourteenth: "fourteen",
        fifteenth: "fifteen",
        sixteenth: "sixteen",
        seventeenth: "seventeen",
        eighteenth: "eighteen",
        nineteenth: "nineteen",
        twentieth: "twenty",
        thirtieth: "thirty",
        fortieth: "forty",
        fiftieth: "fifty",
        sixtieth: "sixty",
        seventieth: "seventy",
        eightieth: "eighty",
        ninetieth: "ninety",
        hundredth: "hundred",
        thousandth: "thousand",
        millionth: "million",
        billionth: "billion",
        trillionth: "trillion",
      };

      const normalized = String(rawInput || "")
        .toLowerCase()
        .replace(/-/g, " ")
        .replace(/,/g, " ")
        .replace(/\b(?:and|please|tab|tabs|number|item|link)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!normalized) {
        return null;
      }

      const tokens = normalized
        .split(" ")
        .filter(Boolean)
        .map((token) => {
          const ordinalDigit = token.match(/^(\d+)(?:st|nd|rd|th)$/);
          if (ordinalDigit) {
            return ordinalDigit[1];
          }
          return ordinalAliases[token] || token;
        });

      let total = 0;
      let current = 0;
      let consumed = 0;

      for (const token of tokens) {
        if (Object.prototype.hasOwnProperty.call(units, token)) {
          current += units[token];
          consumed += 1;
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(tens, token)) {
          current += tens[token];
          consumed += 1;
          continue;
        }

        if (token === "hundred") {
          current = current === 0 ? 100 : current * 100;
          consumed += 1;
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(scales, token)) {
          const scaleValue = scales[token];
          const base = current === 0 ? 1 : current;
          total += base * scaleValue;
          current = 0;
          consumed += 1;
          continue;
        }

        if (/^\d+$/.test(token)) {
          current += Number(token);
          consumed += 1;
          continue;
        }

        return null;
      }

      if (!consumed) {
        return null;
      }

      const result = total + current;
      if (!Number.isSafeInteger(result) || result < 0) {
        return null;
      }

      return result;
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
