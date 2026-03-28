(function initRitoOverlayUI(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  class OverlayUI {
    constructor(options) {
      const opts = options || {};
      this.logger = opts.logger || Rito.createLogger("overlay");
      this.settings = Object.assign(
        {},
        Rito.DEFAULT_SETTINGS,
        opts.settings || {},
      );
      this.rootNode = null;
      this.shadow = null;
      this.feedbackEl = null;
      this.transcriptEl = null;
      this.labelsLayer = null;
      this.numberMap = new Map();
      this.labelRecords = [];
      this.reposition = null;
      this._build();
    }

    applySettings(nextSettings) {
      this.settings = Object.assign({}, this.settings, nextSettings || {});
      if (!this.rootNode) {
        return;
      }
      this.rootNode.dataset.contrast = this.settings.highContrast
        ? "high"
        : "normal";
    }

    _build() {
      if (this.rootNode) {
        return;
      }

      this.rootNode = root.document.createElement("div");
      this.rootNode.id = "rito-overlay-root";
      this.rootNode.dataset.contrast = this.settings.highContrast
        ? "high"
        : "normal";
      this.rootNode.style.all = "initial";
      this.rootNode.style.position = "fixed";
      this.rootNode.style.inset = "0";
      this.rootNode.style.zIndex = "2147483647";
      this.rootNode.style.pointerEvents = "none";

      this.shadow = this.rootNode.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `
        <style>
          :host {
            --rito-bg: rgba(14, 19, 24, 0.88);
            --rito-fg: #f7fafc;
            --rito-accent: #04b388;
            --rito-warning: #f0b429;
            --rito-error: #d64550;
            --rito-outline: rgba(4, 179, 136, 0.35);
            font-family: "Segoe UI Variable", "Aptos", "Trebuchet MS", sans-serif;
          }

          #host[data-contrast="high"] {
            --rito-bg: rgba(0, 0, 0, 0.95);
            --rito-fg: #ffffff;
            --rito-accent: #00f5d4;
            --rito-outline: rgba(255, 255, 255, 0.5);
          }

          .layer {
            position: fixed;
            inset: 0;
            pointer-events: none;
          }

          .feedback {
            position: fixed;
            top: 16px;
            right: 16px;
            max-width: min(420px, calc(100vw - 32px));
            padding: 10px 14px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 600;
            line-height: 1.35;
            background: var(--rito-bg);
            color: var(--rito-fg);
            border: 1px solid var(--rito-outline);
            box-shadow: 0 10px 26px rgba(0, 0, 0, 0.25);
            opacity: 0;
            transform: translateY(-10px);
            transition: transform 160ms ease, opacity 160ms ease;
          }

          .feedback.visible {
            opacity: 1;
            transform: translateY(0);
          }

          .feedback.warning { border-color: color-mix(in srgb, var(--rito-warning), transparent 45%); }
          .feedback.error { border-color: color-mix(in srgb, var(--rito-error), transparent 45%); }

          .transcript {
            position: fixed;
            left: 16px;
            bottom: 16px;
            max-width: min(620px, calc(100vw - 32px));
            padding: 9px 12px;
            border-radius: 12px;
            font-size: 12px;
            color: var(--rito-fg);
            background: color-mix(in srgb, var(--rito-bg), transparent 12%);
            border: 1px solid var(--rito-outline);
            opacity: 0;
            transform: translateY(10px);
            transition: transform 160ms ease, opacity 160ms ease;
          }

          .transcript.visible {
            opacity: 1;
            transform: translateY(0);
          }

          .hint {
            position: fixed;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 700;
            color: #042f2e;
            background: radial-gradient(circle at 25% 25%, #6fffe0, #04b388);
            border: 1px solid rgba(0, 0, 0, 0.2);
            box-shadow: 0 7px 18px rgba(4, 179, 136, 0.38);
            animation: hintIn 170ms ease;
          }

          @keyframes hintIn {
            from { opacity: 0; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1); }
          }
        </style>
        <div id="host">
          <div class="layer" id="labels"></div>
          <div class="feedback" id="feedback" aria-live="polite"></div>
          <div class="transcript" id="transcript" aria-live="polite"></div>
        </div>
      `;

      this.feedbackEl = this.shadow.getElementById("feedback");
      this.transcriptEl = this.shadow.getElementById("transcript");
      this.labelsLayer = this.shadow.getElementById("labels");
      this.shadow.getElementById("host").dataset.contrast = this.settings
        .highContrast
        ? "high"
        : "normal";

      root.document.documentElement.appendChild(this.rootNode);

      this.reposition = Rito.timing.throttle(
        () => this._repositionLabels(),
        80,
      );
      root.addEventListener("scroll", this.reposition, true);
      root.addEventListener("resize", this.reposition, true);
    }

    showFeedback(message, type, timeoutMs) {
      const kind = type || "info";
      const timeout = Number(timeoutMs || 1700);
      this.feedbackEl.textContent = String(message || "");
      this.feedbackEl.className = `feedback ${kind} visible`;

      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = setTimeout(() => {
        this.feedbackEl.className = `feedback ${kind}`;
      }, timeout);
    }

    showTranscript(text, interim) {
      const safeText = String(text || "").trim();
      if (!safeText) {
        return;
      }

      this.transcriptEl.textContent = interim
        ? `Listening: ${safeText}`
        : `Heard: ${safeText}`;
      this.transcriptEl.classList.add("visible");

      clearTimeout(this.transcriptTimer);
      this.transcriptTimer = setTimeout(
        () => {
          this.transcriptEl.classList.remove("visible");
        },
        interim ? 900 : 2000,
      );
    }

    showNumberHints(candidates) {
      this.hideNumberHints();
      const list = Array.isArray(candidates) ? candidates : [];

      list.forEach((candidate, index) => {
        const label = root.document.createElement("div");
        label.className = "hint";
        label.textContent = String(index + 1);
        this.labelsLayer.appendChild(label);

        this.numberMap.set(index + 1, candidate.element);
        this.labelRecords.push({ element: candidate.element, label });
      });

      this._repositionLabels();
      this.showFeedback(
        `Numbered ${list.length} actionable elements`,
        "info",
        1300,
      );
    }

    hideNumberHints() {
      this.numberMap.clear();
      this.labelRecords.forEach((record) => {
        if (record.label && record.label.remove) {
          record.label.remove();
        }
      });
      this.labelRecords = [];
    }

    getElementForNumber(number) {
      return this.numberMap.get(Number(number)) || null;
    }

    _repositionLabels() {
      this.labelRecords.forEach((record) => {
        if (!record.element || !record.element.isConnected) {
          record.label.style.display = "none";
          return;
        }

        const rect = record.element.getBoundingClientRect();
        const inViewport =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < root.innerHeight &&
          rect.left < root.innerWidth;

        if (!inViewport) {
          record.label.style.display = "none";
          return;
        }

        record.label.style.display = "inline-flex";
        record.label.style.left = `${Math.max(4, rect.left - 10)}px`;
        record.label.style.top = `${Math.max(4, rect.top - 10)}px`;
      });
    }
  }

  Rito.OverlayUI = OverlayUI;
})(typeof globalThis !== "undefined" ? globalThis : window);
