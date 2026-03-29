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
      if (
        !command.metaNoDedup &&
        this._isDuplicate(command, settings.commandCooldownMs)
      ) {
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

        case "multiStep":
          return this._executeMultiStep(command.steps, context);

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

        case "hover":
          return this._hoverByTarget(command.target);

        case "hoverNumber":
          return this._hoverByNumber(command.index);

        case "findTopic":
          return this._findTopic(command.target);

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

        case "summarizePage":
          return this._summarizePage(command.context);
        case "deleteAllWords":
          return this._deleteAllWords();

        case "deleteMultipleWords":
          return this._deleteMultipleWords(command.count);

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
        const response = await this._sendBrowserCommandMessage(command);

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
        const failure = this._normalizeMessagingFailure(error);
        const errorMessage = failure.message || "Unknown messaging error";

        // Some browser actions can interrupt the sender frame before
        // the response returns even though the action was applied.
        if (this._isResponseInterruptionForAction(action, errorMessage)) {
          this.overlayUI.showFeedback("Command sent", "info", 900);
          this.logger.warn("Browser command response interrupted", {
            command,
            message: errorMessage,
          });
          return {
            ok: true,
            reason: "browser_response_interrupted",
          };
        }

        if (this._isExtensionContextInvalidatedError(errorMessage)) {
          this.overlayUI.showFeedback(
            "Extension was reloaded. Refresh this tab and try again.",
            "warning",
            2200,
          );
        } else {
          this.overlayUI.showFeedback(
            "Unable to reach background service",
            "error",
            1600,
          );
        }

        this.logger.error(
          `Browser command messaging failed (${action}): ${errorMessage}`,
        );
        this.logger.debug("Browser command messaging details", {
          command,
          error,
        });
        return { ok: false, reason: "browser_messaging_error" };
      }
    }

    async _sendBrowserCommandMessage(command) {
      const maxAttempts = 2;
      let lastFailure = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await chrome.runtime.sendMessage({
            type: Rito.MESSAGE_TYPES.BROWSER_COMMAND,
            payload: Object.assign({}, command),
          });
        } catch (error) {
          const failure = this._normalizeMessagingFailure(error);
          lastFailure = failure;
          if (
            attempt < maxAttempts &&
            this._isRetryableMessagingError(failure.message)
          ) {
            await this._wait(120 * attempt);
            continue;
          }
          throw failure;
        }
      }

      throw lastFailure || new Error("Unknown browser messaging failure");
    }

    _wait(ms) {
      return new Promise((resolve) => {
        root.setTimeout(resolve, Math.max(0, Number(ms || 0)));
      });
    }

    _normalizeMessagingFailure(error) {
      if (!error) {
        return {
          message: "Unknown browser messaging failure",
          detail: null,
        };
      }

      if (typeof error === "string") {
        return {
          message: error,
          detail: error,
        };
      }

      const message = String(
        (error && error.message) ||
          (error && error.toString && error.toString()) ||
          "Unknown browser messaging failure",
      );

      return {
        message,
        detail: error,
      };
    }

    _isRetryableMessagingError(message) {
      const value = String(message || "").toLowerCase();
      return (
        value.includes("receiving end does not exist") ||
        value.includes("could not establish connection") ||
        value.includes("message port closed before a response was received")
      );
    }

    _isExtensionContextInvalidatedError(message) {
      const value = String(message || "").toLowerCase();
      return value.includes("extension context invalidated");
    }

    _isResponseInterruptionForAction(action, message) {
      const interruption = String(message || "")
        .toLowerCase()
        .includes("message port closed before a response was received");
      if (!interruption) {
        return false;
      }

      const senderDisruptiveActions = new Set([
        "NEXT_TAB",
        "PREVIOUS_TAB",
        "GO_TO_TAB_INDEX",
        "SWITCH_TAB_TITLE",
        "GO_BACK",
        "GO_FORWARD",
        "REFRESH_TAB",
        "OPEN_URL",
        "CLOSE_TAB",
        "MOVE_TAB_TO_NEW_WINDOW",
      ]);

      return senderDisruptiveActions.has(String(action || ""));
    }

    async _executeMultiStep(steps, context) {
      const sequence = Array.isArray(steps) ? steps : [];
      if (!sequence.length) {
        return { ok: false, reason: "empty_multi_step" };
      }

      for (const step of sequence) {
        const result = await this.execute(
          Object.assign({}, step, { metaNoDedup: true }),
          context,
        );
        if (!result || !result.ok) {
          return result || { ok: false, reason: "multi_step_failed" };
        }
      }

      return { ok: true };
    }

    async _summarizePage(context) {
      const pageContext = context || this._buildPageContext();
      try {
        const response = await chrome.runtime.sendMessage({
          type: Rito.MESSAGE_TYPES.AI_SUMMARIZE_PAGE,
          payload: { context: pageContext },
        });

        if (!response || !response.ok) {
          this.overlayUI.showFeedback(
            (response && response.error) || "Unable to summarize this page",
            "warning",
            1800,
          );
          return { ok: false, reason: "summary_failed" };
        }

        const summary = response.data || {};
        const summaryText = String(summary.summary || "").trim();
        const keyPoints = Array.isArray(summary.keyPoints)
          ? summary.keyPoints
              .map((point) => String(point).trim())
              .filter(Boolean)
          : [];

        const combined = keyPoints.length
          ? `${summaryText} Key points: ${keyPoints.slice(0, 2).join("; ")}`
          : summaryText;

        const overlayText =
          combined.length > 250 ? `${combined.slice(0, 247)}...` : combined;

        this.overlayUI.showFeedback(
          overlayText || "Summary generated",
          "info",
          5200,
        );

        return { ok: true, data: summary };
      } catch (error) {
        this.logger.error("Summary request failed", error);
        this.overlayUI.showFeedback(
          "Unable to summarize this page",
          "error",
          1800,
        );
        return { ok: false, reason: "summary_error" };
      }
    }

    _buildPageContext() {
      return {
        url: String(
          root.location && root.location.href ? root.location.href : "",
        ),
        title: String(
          root.document && root.document.title ? root.document.title : "",
        ),
        visibleText: String(
          (root.document &&
            root.document.body &&
            root.document.body.innerText) ||
            "",
        ).slice(0, 2000),
      };
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

    async _clickByTarget(target, openInNewTab, forceFirst) {
      const query = String(target || "").trim();
      let matches = this.domNavigator.findInteractiveByText(query, {
        maxResults: 5,
      });

      if (!matches.length) {
        const reveal = await this.domNavigator.revealByHoverSweep({
          query,
          maxCandidates: 10,
          delayMs: 50,
        });

        if (reveal.hovered > 0) {
          matches = this.domNavigator.findInteractiveByText(query, {
            maxResults: 5,
          });
        }
      }

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

    async _hoverByTarget(target) {
      const query = String(target || "").trim();
      if (!query) {
        this.overlayUI.showFeedback("Say what to hover", "warning", 1200);
        return { ok: false, reason: "missing_hover_target" };
      }

      const direct = this.domNavigator.findHoverableByText(query, {
        maxResults: 4,
      });

      if (direct.length) {
        this.domNavigator.triggerHover(direct[0].element);
        this.overlayUI.showFeedback(`Hovered ${query}`, "info", 900);
        return { ok: true };
      }

      const reveal = await this.domNavigator.revealByHoverSweep({
        query,
        maxCandidates: 10,
        delayMs: 50,
      });

      if (reveal.hovered > 0) {
        this.overlayUI.showFeedback("Hovered navigation controls", "info", 900);
        return { ok: true };
      }

      this.overlayUI.showFeedback(
        `No hover target found for \"${query}\"`,
        "warning",
        1400,
      );
      return { ok: false, reason: "hover_target_not_found" };
    }

    async _hoverByNumber(index) {
      const numericIndex = Number(index);
      if (!Number.isInteger(numericIndex) || numericIndex < 1) {
        this.overlayUI.showFeedback("Invalid hover number", "warning", 1200);
        return { ok: false, reason: "invalid_hover_number" };
      }

      let element = this.overlayUI.getElementForNumber(numericIndex);
      if (!element) {
        const candidate = this.domNavigator.findByNumber(numericIndex);
        element = candidate && candidate.element;
      }

      if (!element) {
        this.overlayUI.showFeedback(
          "No element found for that number",
          "warning",
          1400,
        );
        return { ok: false, reason: "hover_number_not_found" };
      }

      const hovered = this.domNavigator.triggerHover(element);
      if (!hovered) {
        this.overlayUI.showFeedback(
          "Could not hover that element",
          "warning",
          1400,
        );
        return { ok: false, reason: "hover_number_failed" };
      }

      this.overlayUI.showFeedback(`Hovered ${numericIndex}`, "info", 900);
      return { ok: true };
    }

    async _findTopic(target) {
      const query = String(target || "").trim();
      if (!query) {
        this.overlayUI.showFeedback("Say what to look for", "warning", 1200);
        return { ok: false, reason: "missing_topic_query" };
      }

      let matches = this.domNavigator.findInteractiveByText(query, {
        maxResults: 8,
      });

      if (!matches.length) {
        const reveal = await this.domNavigator.revealByHoverSweep({
          query,
          maxCandidates: 12,
          delayMs: 50,
        });

        if (reveal.hovered > 0) {
          matches = this.domNavigator.findInteractiveByText(query, {
            maxResults: 8,
          });
        }
      }

      if (!matches.length) {
        this.overlayUI.showFeedback(
          `No visible matches for "${query}"`,
          "warning",
          1700,
        );
        return { ok: false, reason: "topic_not_found" };
      }

      this.overlayUI.showNumberHints(matches);

      const bestMatch = matches[0];
      if (bestMatch && bestMatch.element && bestMatch.element.scrollIntoView) {
        bestMatch.element.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      }

      this.overlayUI.showFeedback(
        `Found ${matches.length} match${matches.length === 1 ? "" : "es"} for "${query}". Say "click 1" to open the top result.`,
        "info",
        2400,
      );

      return { ok: true, count: matches.length };
    }

    _activateElement(element, openInNewTab) {
      const actionElement = this._resolveActionableElement(element);

      if (!actionElement || !actionElement.isConnected) {
        this.overlayUI.showFeedback(
          "Target is no longer available",
          "warning",
          1400,
        );
        return { ok: false, reason: "stale_element" };
      }

      actionElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
      try {
        actionElement.focus({ preventScroll: true });
      } catch (_error) {
        // Non-focusable targets are still valid for activation.
      }

      // Many menu controls only respond after a hover phase.
      this.domNavigator.triggerHover(actionElement);

      if (openInNewTab) {
        const href = this._extractNavigableUrl(actionElement, element);
        if (href) {
          root.open(href, "_blank", "noopener,noreferrer");
          this.overlayUI.showFeedback("Opened in new tab", "info", 1100);
          return { ok: true };
        }
      }

      try {
        actionElement.click();
      } catch (_error) {
        actionElement.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }

      this.overlayUI.showFeedback("Activated", "info", 900);
      return { ok: true };
    }

    _resolveActionableElement(element) {
      if (!element || !element.isConnected) {
        return null;
      }

      const actionableSelector = [
        "a[href]",
        "button",
        "input[type='button']",
        "input[type='submit']",
        "summary",
        "[role='button']",
        "[role='link']",
        "[role='tab']",
        "[aria-expanded]",
        "[data-toggle='collapse']",

        "[onclick]",
      ].join(",");

      const isDisabled = (candidate) => {
        if (!candidate) {
          return true;
        }
        if (candidate.disabled) {
          return true;
        }
        return (
          String(
            candidate.getAttribute("aria-disabled") || "",
          ).toLowerCase() === "true"
        );
      };

      if (
        element.matches &&
        element.matches(actionableSelector) &&
        !isDisabled(element)
      ) {
        return element;
      }

      if (element.closest) {
        const closestActionable = element.closest(actionableSelector);
        if (closestActionable && !isDisabled(closestActionable)) {
          return closestActionable;
        }
      }

      if (element.querySelector) {
        const childActionable = element.querySelector(actionableSelector);
        if (childActionable && !isDisabled(childActionable)) {
          return childActionable;
        }
      }

      return element;
    }

    _extractNavigableUrl(primaryElement, fallbackElement) {
      const sources = [primaryElement, fallbackElement];
      for (const candidate of sources) {
        if (!candidate) {
          continue;
        }

        const href = candidate.href || candidate.getAttribute("href");
        if (href) {
          return href;
        }

        const dataHref = candidate.getAttribute("data-href");
        if (dataHref) {
          return dataHref;
        }
      }

      return "";
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

    _deleteAllWords() {
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
        target.textContent = "";
        this.overlayUI.showFeedback("Deleted all words", "info", 850);
        return { ok: true };
      }

      target.value = "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      this.overlayUI.showFeedback("Deleted all words", "info", 850);
      return { ok: true };
    }

    _deleteMultipleWords(count) {
      const target = this.domNavigator.focusBestEditable();
      if (!target) {
        this.overlayUI.showFeedback(
          "Focus an input field first",
          "warning",
          1300,
        );
        return { ok: false, reason: "no_editable_target" };
      }

      const countNum = Number(count) || 1;
      if (countNum < 1) {
        this.overlayUI.showFeedback("Invalid word count", "warning", 850);
        return { ok: false, reason: "invalid_count" };
      }

      if (target.isContentEditable) {
        const text = String(target.textContent || "");
        let result = text;
        for (let i = 0; i < countNum; i++) {
          result = result.replace(/\s*\S+\s*$/, " ");
        }
        target.textContent = result;
        this.overlayUI.showFeedback(
          `Deleted last ${countNum} word${countNum > 1 ? "s" : ""}`,
          "info",
          850,
        );
        return { ok: true };
      }

      const value = String(target.value || "");
      let result = value;
      for (let i = 0; i < countNum; i++) {
        result = result.replace(/\s*\S+\s*$/, " ");
      }
      target.value = result;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      this.overlayUI.showFeedback(
        `Deleted last ${countNum} word${countNum > 1 ? "s" : ""}`,
        "info",
        850,
      );
      return { ok: true };
    }
  }

  Rito.CommandExecutor = CommandExecutor;
})(typeof globalThis !== "undefined" ? globalThis : window);
