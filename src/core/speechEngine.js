(function initRitoSpeechEngine(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  class SpeechEngine extends EventTarget {
    constructor(options) {
      super();
      const opts = options || {};
      this.logger = opts.logger || Rito.createLogger("speech");
      this.settings = Object.assign(
        {},
        Rito.DEFAULT_SETTINGS,
        opts.settings || {},
      );
      this.mode = Rito.COMMAND_MODES.COMMANDS;
      this.recognition = null;
      this.shouldRun = false;
      this.isListening = false;
      this.restartTimer = null;
      this.armedUntil = 0;
      this.restartCount = 0;
      this.mediaStream = null;
      this.audioContext = null;
      this.analyser = null;
    }

    updateSettings(nextSettings) {
      this.settings = Object.assign({}, this.settings, nextSettings || {});
      if (this.recognition) {
        this.recognition.lang = this.settings.commandLanguage;
        this.recognition.continuous = Boolean(
          this.settings.continuousListening,
        );
      }
    }

    setMode(mode) {
      this.mode = mode;
    }

    start() {
      if (this.shouldRun) {
        return;
      }
      this.shouldRun = true;

      if (!this._getRecognitionCtor()) {
        this._emit("error", {
          code: "unsupported",
          message:
            "Speech recognition is not supported in this browser context.",
        });
        return;
      }

      if (!this.recognition) {
        this._buildRecognition();
      }

      this._beginRecognition();
    }

    stop() {
      this.shouldRun = false;
      this.armedUntil = 0;
      clearTimeout(this.restartTimer);
      this.restartTimer = null;

      if (this.recognition && this.isListening) {
        try {
          this.recognition.stop();
        } catch (error) {
          this.logger.debug("Ignoring stop error.", error);
        }
      }

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => {
          track.stop();
        });
        this.mediaStream = null;
      }

      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
        this.analyser = null;
      }
    }

    pause() {
      // Temporary pause without stopping resources (for background tabs)
      if (this.recognition && this.isListening) {
        try {
          this.recognition.stop();
          this.logger.debug("Speech recognition paused");
        } catch (error) {
          this.logger.debug("Error pausing recognition", error);
        }
      }
    }

    resume() {
      // Resume after pause if shouldRun is still true
      if (this.shouldRun && !this.isListening) {
        this._beginRecognition();
        this.logger.debug("Speech recognition resumed");
      }
    }

    _getRecognitionCtor() {
      return root.SpeechRecognition || root.webkitSpeechRecognition || null;
    }

    _buildRecognition() {
      const SpeechRecognition = this._getRecognitionCtor();
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = Boolean(this.settings.continuousListening);
      this.recognition.interimResults = true;
      this.recognition.lang = this.settings.commandLanguage;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.restartCount = 0;
        this.isListening = true;
        this._initializeAudioMonitoring();
        this._emit("listening-state", { listening: true });
        this.logger.debug("Speech recognition started");
      };

      this.recognition.onresult = (event) => {
        this._handleResult(event);
      };

      this.recognition.onerror = (event) => {
        this._handleError(event);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this._emit("listening-state", { listening: false });
        if (this.shouldRun) {
          this._scheduleRestart("onend");
        }
      };
    }

    _beginRecognition() {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;

      try {
        this.recognition.start();
      } catch (error) {
        if (String(error && error.message).includes("already started")) {
          return;
        }
        this.logger.warn("Recognition failed to start, retrying.", error);
        this._scheduleRestart("start_failed");
      }
    }

    _scheduleRestart(reason) {
      if (!this.shouldRun) {
        return;
      }

      this.restartCount += 1;
      const delay = Math.min(4000, 500 + this.restartCount * 300);
      this.logger.debug("Scheduling speech restart.", { reason, delay });

      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        if (!this.shouldRun) {
          return;
        }
        this._beginRecognition();
      }, delay);
    }

    _applyHotwordGate(originalText) {
      const transcript = String(originalText || "").trim();
      const hotword = Rito.fuzzy.normalizeText(this.settings.hotword || "");

      if (!hotword || this.mode === Rito.COMMAND_MODES.DICTATION) {
        return { accepted: true, text: transcript };
      }

      const normalized = Rito.fuzzy.normalizeText(transcript);
      const now = Date.now();

      if (normalized === hotword) {
        this.armedUntil = now + 10000;
        this._emit("hotword", { hotword: this.settings.hotword, armed: true });
        return { accepted: false, reason: "armed_only" };
      }

      const startsWithHotword = normalized.startsWith(`${hotword} `);
      if (startsWithHotword) {
        const hotwordRegex = new RegExp(`^${this.settings.hotword}\\s+`, "i");
        return {
          accepted: true,
          text: transcript.replace(hotwordRegex, "").trim(),
        };
      }

      if (now <= this.armedUntil) {
        return { accepted: true, text: transcript };
      }

      return { accepted: false, reason: "hotword_required" };
    }

    _handleResult(event) {
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternative = result[0] || { transcript: "", confidence: 0 };
        const transcript = String(alternative.transcript || "").trim();
        const confidence = Number(alternative.confidence || 0);

        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          const minConfidence = Math.max(
            0,
            Math.min(1, this.settings.microphoneSensitivity * 0.5),
          );
          const gateResult = this._applyHotwordGate(transcript);

          if (!gateResult.accepted) {
            this.logger.debug("Transcript rejected by hotword gate", {
              reason: gateResult.reason,
              transcript,
            });
            this._emit("ignored", {
              reason: gateResult.reason,
              transcript,
              confidence,
            });
            continue;
          }

          if (confidence > 0 && confidence < minConfidence) {
            this.logger.debug("Transcript rejected by confidence threshold", {
              transcript,
              confidence,
              minConfidence,
            });
            this._emit("ignored", {
              reason: "low_confidence",
              transcript,
              confidence,
            });
            continue;
          }

          this.logger.debug("Final transcript accepted", {
            text: gateResult.text,
            confidence,
          });
          this._emit("final-transcript", {
            text: gateResult.text,
            confidence,
            originalText: transcript,
          });
        } else {
          interimText += `${transcript} `;
        }
      }

      if (interimText.trim()) {
        this._emit("interim-transcript", { text: interimText.trim() });
      }
    }

    _handleError(event) {
      const errorCode = event && event.error ? event.error : "unknown";
      this.logger.warn("Speech recognition error", {
        errorCode,
        message: `Speech engine error: ${errorCode}`,
      });
      this._emit("error", {
        code: errorCode,
        message: `Speech engine error: ${errorCode}`,
      });

      if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
        this.logger.error("Microphone permission not granted");
        this.shouldRun = false;
        return;
      }

      if (errorCode === "audio-capture") {
        this.logger.warn("No audio input detected on device");
      }

      if (this.shouldRun) {
        this._scheduleRestart("onerror");
      }
    }

    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
    }

    _initializeAudioMonitoring() {
      if (this.analyser) {
        return;
      }

      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) {
        this.logger.debug("AudioContext not available for monitoring");
        return;
      }

      try {
        this.audioContext = new AudioContext();
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            this.mediaStream = stream;
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            source.connect(this.analyser);
            this._monitorAudioLevel();
          })
          .catch((error) => {
            this.logger.debug("Audio monitoring permission denied", error);
          });
      } catch (error) {
        this.logger.debug("Failed to initialize audio monitoring", error);
      }
    }

    _monitorAudioLevel() {
      if (!this.isListening || !this.analyser) {
        return;
      }

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);

      const average =
        dataArray.reduce((a, b) => a + b) / dataArray.length / 255;
      const audioLevel = Math.round(average * 100);

      if (audioLevel > 5) {
        this._emit("audio-level", { level: audioLevel });
      }

      requestAnimationFrame(() => {
        this._monitorAudioLevel();
      });
    }
  }

  Rito.SpeechEngine = SpeechEngine;
})(typeof globalThis !== "undefined" ? globalThis : window);
