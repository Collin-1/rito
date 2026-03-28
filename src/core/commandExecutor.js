(function initRitoCommandExecutor(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  class CommandExecutor {
    constructor(options) {
      const opts = options || {};
      this.logger = opts.logger || Rito.createLogger("executor");
      this.domNavigator = opts.domNavigator;
      this.overlayUI = opts.overlayUI;
      this.getSettings = opts.getSettings || (() => Rito.DEFAULT_SETTINGS);
      this.lastSignature = "";
      this.lastExecutedAt = 0;
    }

    async execute(command, context) {
      if (!command || !command.action) {
        return { ok: false, reason: "invalid_command" };
      }

      const settings = this.getSettings();
      if (this._isDuplicate(command, settings.commandCooldownMs)) {
        return { ok: false, reason: "duplicate" };
      }

      if (command.scope === "browser") {
        return this._executeBrowserCommand(command);
      }

      const callbacks = context || {};

      switch (command.action) {
        case "setMode":
          if (callbacks.onModeChange) {
            callbacks.onModeChange(command.mode);
            return { ok: true };
          }
          return { ok: false, reason: "missing_mode_callback" };

        case "setListening":
          if (callbacks.onListeningChange) {
            callbacks.onListeningChange(command.listening);
            return { ok: true };
          }
          return { ok: false, reason: "missing_listening_callback" };

        case "scroll":
          root.scrollBy({
            top:
              command.direction === "up"
                ? -Math.abs(command.amount)
                : Math.abs(command.amount),
            left: 0,
            behavior: "smooth",
          });
          this.overlayUI.showFeedback(
            `Scrolling ${command.direction}`,
            "info",
            900,
          );
          return { ok: true };

        case "goBack":
          return this._executeBrowserCommand({
            scope: "browser",
            action: "GO_BACK",
          });

        case "goForward":
          return this._executeBrowserCommand({
            scope: "browser",
            action: "GO_FORWARD",
          });

        case "refresh":
          return this._executeBrowserCommand({
            scope: "browser",
            action: "REFRESH_TAB",
          });

        case "showNumbers": {
          const candidates = this.domNavigator.scanInteractiveElements({
            onlyViewport: true,
          });
          this.overlayUI.showNumberHints(candidates);
          return { ok: true, count: candidates.length };
        }

        case "hideNumbers":
          this.overlayUI.hideNumberHints();
          this.overlayUI.showFeedback("Number hints hidden", "info", 850);
          return { ok: true };

        case "clickNumber":
          return this._clickNumber(command.index);

        case "click":
          return this._clickByTarget(command.target, false);

        case "openInNewTab":
          return this._clickByTarget(command.target, true);

        case "selectFirstResult":
          return this._clickByTarget(command.target || "result", false, true);

        case "fillField":
          return this._insertText(command.text, false, command.fieldHint);

        case "type":
          return this._insertText(command.text, false);

        case "dictate":
          return this._insertText(command.text, Boolean(command.appendSpace));

        case "insertNewLine":
          return this._insertText("\n", false);

        case "deleteLastWord":
          return this._deleteLastWord();

        case "unknown":
        default:
          this.overlayUI.showFeedback(
            "Command not recognized",
            "warning",
            1400,
          );
          return { ok: false, reason: "unknown_command" };
      }
    }

    _isDuplicate(command, cooldownMs) {
      const signature = JSON.stringify(command);
      const now = Date.now();
      const cooldown = Math.max(150, Number(cooldownMs || 500));

      if (
        this.lastSignature === signature &&
        now - this.lastExecutedAt < cooldown
      ) {
        this.logger.debug("Skipping duplicate command", command);
        return true;
      }

      this.lastSignature = signature;
      this.lastExecutedAt = now;
      return false;
    }

    async _executeBrowserCommand(command) {
      const action = String(command.action || "");
      if (!action) {
        return { ok: false, reason: "missing_browser_action" };
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: Rito.MESSAGE_TYPES.BROWSER_COMMAND,
          payload: Object.assign({}, command),
        });

        if (!response || !response.ok) {
          const reason =
            (response && response.error) || "Browser action failed";
          this.overlayUI.showFeedback(reason, "warning", 1500);
          return { ok: false, reason: "browser_command_failed" };
        }

        if (response.message) {
          this.overlayUI.showFeedback(response.message, "info", 1300);
        }

        return { ok: true, data: response.data || null };
      } catch (error) {
        this.overlayUI.showFeedback(
          "Unable to reach background service",
          "error",
          1600,
        );
        this.logger.error("Browser command messaging failed", {
          command,
          error,
        });
        return { ok: false, reason: "browser_messaging_error" };
      }
    }

    _clickNumber(index) {
      const fromOverlay = this.overlayUI.getElementForNumber(index);
      if (fromOverlay) {
        return this._activateElement(fromOverlay, false);
      }

      const candidate = this.domNavigator.findByNumber(index);
      if (!candidate) {
        this.overlayUI.showFeedback(
          "No element found for that number",
          "warning",
          1400,
        );
        return { ok: false, reason: "number_not_found" };
      }

      return this._activateElement(candidate.element, false);
    }

    _clickByTarget(target, openInNewTab, forceFirst) {
      const query = String(target || "").trim();
      const matches = this.domNavigator.findInteractiveByText(query, {
        maxResults: 5,
      });

      if (!matches.length) {
        this.overlayUI.showFeedback(
          `No match found for \"${query}\"`,
          "warning",
          1500,
        );
        return { ok: false, reason: "no_match" };
      }

      if (!forceFirst && matches.length > 1) {
        const top = matches[0].score;
        const second = matches[1].score;
        if (top - second < 0.08) {
          this.overlayUI.showFeedback(
            "Multiple matches found, showing numbers",
            "warning",
            1600,
          );
          this.overlayUI.showNumberHints(matches);
          return { ok: false, reason: "multiple_matches" };
        }
      }

      const winner = matches[0];

      if (openInNewTab && !query) {
        const linkCandidate = matches.find((match) => {
          const element = match.element;
          return element && (element.href || element.getAttribute("href"));
        });
        if (linkCandidate) {
          return this._activateElement(linkCandidate.element, true);
        }
      }

      return this._activateElement(winner.element, openInNewTab);
    }

    _activateElement(element, openInNewTab) {
      if (!element || !element.isConnected) {
        this.overlayUI.showFeedback(
          "Target is no longer available",
          "warning",
          1400,
        );
        return { ok: false, reason: "stale_element" };
      }

      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
      element.focus({ preventScroll: true });

      if (openInNewTab) {
        const href = element.href || element.getAttribute("href");
        if (href) {
          root.open(href, "_blank", "noopener,noreferrer");
          this.overlayUI.showFeedback("Opened in new tab", "info", 1100);
          return { ok: true };
        }
      }

      element.click();
      this.overlayUI.showFeedback("Activated", "info", 900);
      return { ok: true };
    }

    _insertText(text, appendSpace, fieldHint) {
      const rawText = String(text || "");
      const finalText = appendSpace ? `${rawText} ` : rawText;
      const target = this.domNavigator.focusBestEditable(fieldHint);

      if (!target) {
        this.overlayUI.showFeedback(
          "Focus an input field first",
          "warning",
          1500,
        );
        return { ok: false, reason: "no_editable_target" };
      }

      if (target.isContentEditable) {
        target.focus();
        root.document.execCommand("insertText", false, finalText);
        this.overlayUI.showFeedback("Dictation inserted", "info", 900);
        return { ok: true };
      }

      const supportsSelection = typeof target.selectionStart === "number";
      if (supportsSelection) {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const prefix = target.value.slice(0, start);
        const suffix = target.value.slice(end);
        target.value = `${prefix}${finalText}${suffix}`;
        const cursor = start + finalText.length;
        target.selectionStart = cursor;
        target.selectionEnd = cursor;
      } else {
        target.value = `${target.value || ""}${finalText}`;
      }

      target.dispatchEvent(new Event("input", { bubbles: true }));
      this.overlayUI.showFeedback("Text entered", "info", 850);
      return { ok: true };
    }

    _deleteLastWord() {
      const target = this.domNavigator.focusBestEditable();
      if (!target) {
        this.overlayUI.showFeedback(
          "Focus an input field first",
          "warning",
          1300,
        );
        return { ok: false, reason: "no_editable_target" };
      }

      if (target.isContentEditable) {
        const text = String(target.textContent || "");
        target.textContent = text.replace(/\s*\S+\s*$/, " ");
        this.overlayUI.showFeedback("Deleted last word", "info", 850);
        return { ok: true };
      }

      const value = String(target.value || "");
      target.value = value.replace(/\s*\S+\s*$/, " ");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      this.overlayUI.showFeedback("Deleted last word", "info", 850);
      return { ok: true };
    }
  }

  Rito.CommandExecutor = CommandExecutor;
})(typeof globalThis !== "undefined" ? globalThis : window);
