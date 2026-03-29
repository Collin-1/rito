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
      if (!transcript) {
        return { accepted: false, reason: "hotword_required" };
      }

      const activationMode = String(
        this.settings.commandActivationMode || Rito.ACTIVATION_MODES.ALWAYS,
      );

      if (
        activationMode !== Rito.ACTIVATION_MODES.WAKE_PHRASE ||
        this.mode === Rito.COMMAND_MODES.DICTATION
      ) {
        return { accepted: true, text: transcript };
      }

      const normalized = Rito.fuzzy.normalizeText(transcript);
      const now = Date.now();
      const hotword = Rito.fuzzy.normalizeText(
        this.settings.hotword || Rito.DEFAULT_WAKE_PHRASE,
      );

      if (!normalized) {
        return { accepted: false, reason: "hotword_required" };
      }

      if (hotword && normalized === hotword) {
        this.armedUntil = now + 10000;
        this._emit("hotword", {
          hotword: this.settings.hotword || Rito.DEFAULT_WAKE_PHRASE,
          armed: true,
        });
        return { accepted: false, reason: "armed_only" };
      }

      const wakePhrases = this._getWakePhrases();
      const wakeMatch = this._matchWakePrefix(normalized, wakePhrases);

      if (wakeMatch.matched) {
        this.armedUntil = now + 7000;
        this._emit("hotword", {
          hotword: wakeMatch.phrase || Rito.DEFAULT_WAKE_PHRASE,
          armed: true,
        });

        const commandText = this._normalizeWakeCommandText(wakeMatch.remainder);
        if (!commandText) {
          return { accepted: false, reason: "armed_only" };
        }

        return {
          accepted: true,
          text: commandText,
        };
      }

      if (now <= this.armedUntil) {
        return { accepted: true, text: transcript };
      }

      return { accepted: false, reason: "hotword_required" };
    }

    _getWakePhrases() {
      const phrases = new Set();
      const customHotword = Rito.fuzzy.normalizeText(
        this.settings.hotword || "",
      );
      if (customHotword) {
        phrases.add(customHotword);
      }

      const aliases = Array.isArray(Rito.WAKE_PHRASE_ALIASES)
        ? Rito.WAKE_PHRASE_ALIASES
        : [];
      for (const alias of aliases) {
        const normalizedAlias = Rito.fuzzy.normalizeText(alias);
        if (normalizedAlias) {
          phrases.add(normalizedAlias);
        }
      }

      if (!phrases.size) {
        phrases.add(Rito.DEFAULT_WAKE_PHRASE);
      }

      return Array.from(phrases).sort(
        (left, right) => right.length - left.length,
      );
    }

    _matchWakePrefix(normalizedTranscript, wakePhrases) {
      const transcriptTokens = String(normalizedTranscript || "")
        .split(" ")
        .filter(Boolean);

      if (!transcriptTokens.length) {
        return { matched: false, phrase: "", remainder: "" };
      }

      for (const phrase of wakePhrases) {
        const phraseTokens = String(phrase || "")
          .split(" ")
          .filter(Boolean);
        if (
          !phraseTokens.length ||
          transcriptTokens.length < phraseTokens.length
        ) {
          continue;
        }

        const prefix = transcriptTokens.slice(0, phraseTokens.length).join(" ");
        const similarity = Rito.fuzzy.similarityScore(prefix, phrase);
        if (prefix !== phrase && similarity < 0.64) {
          continue;
        }

        const remainder = transcriptTokens
          .slice(phraseTokens.length)
          .join(" ")
          .trim();
        return {
          matched: true,
          phrase,
          remainder,
        };
      }

      // Extra tolerance for split ASR output like: "hay rto", "he ritu".
      if (transcriptTokens.length >= 2) {
        const firstToken = transcriptTokens[0];
        const secondToken = transcriptTokens[1];
        const leadVariants = [
          "hey",
          "hay",
          "hi",
          "hy",
          "he",
          "ei",
          "hello",
          "helo",
          "hullo",
          "ello",
        ];
        const nameVariants = [
          "rito",
          "rto",
          "rita",
          "ritu",
          "rido",
          "rida",
          "reto",
          "retoh",
          "reedo",
          "reeta",
        ];

        const leadKey = this._phoneticWakeKey(firstToken);
        const nameKey = this._phoneticWakeKey(secondToken);
        let leadScore = 0;
        let nameScore = 0;

        for (const variant of leadVariants) {
          leadScore = Math.max(
            leadScore,
            Rito.fuzzy.similarityScore(leadKey, this._phoneticWakeKey(variant)),
          );
        }

        for (const variant of nameVariants) {
          nameScore = Math.max(
            nameScore,
            Rito.fuzzy.similarityScore(nameKey, this._phoneticWakeKey(variant)),
          );
        }

        if (leadScore >= 0.56 && nameScore >= 0.5) {
          return {
            matched: true,
            phrase: `${firstToken} ${secondToken}`,
            remainder: transcriptTokens.slice(2).join(" ").trim(),
          };
        }
      }

      // Some ASR outputs collapse or misspell wake words as a single token,
      // e.g. "hyrita" or "heyrto". Handle those with compact + phonetic scoring.
      const firstToken = transcriptTokens[0] || "";
      const compactFirstToken = this._compactWakeText(firstToken);

      if (compactFirstToken.length >= 4) {
        let best = { score: 0, phrase: "" };

        for (const phrase of wakePhrases) {
          const compactPhrase = this._compactWakeText(phrase);
          if (!compactPhrase) {
            continue;
          }

          const literalScore = Rito.fuzzy.similarityScore(
            compactFirstToken,
            compactPhrase,
          );
          const phoneticScore = Rito.fuzzy.similarityScore(
            this._phoneticWakeKey(compactFirstToken),
            this._phoneticWakeKey(compactPhrase),
          );
          const consonantScore = Rito.fuzzy.similarityScore(
            this._consonantWakeKey(compactFirstToken),
            this._consonantWakeKey(compactPhrase),
          );

          const score = Math.max(literalScore, phoneticScore, consonantScore);
          if (score > best.score) {
            best = { score, phrase };
          }
        }

        if (best.score >= 0.58) {
          return {
            matched: true,
            phrase: best.phrase,
            remainder: transcriptTokens.slice(1).join(" ").trim(),
          };
        }
      }

      return { matched: false, phrase: "", remainder: "" };
    }

    _compactWakeText(value) {
      return Rito.fuzzy.normalizeText(value).replace(/\s+/g, "");
    }

    _phoneticWakeKey(value) {
      return this._compactWakeText(value)
        .replace(/([a-z])\1+/g, "$1")
        .replace(/y/g, "i")
        .replace(/ee|ea|ei|ey|ie|ai|ay/g, "i")
        .replace(/oo|ou|ue|ui/g, "u")
        .replace(/ph/g, "f")
        .replace(/ck/g, "k")
        .replace(/q/g, "k")
        .replace(/x/g, "ks")
        .replace(/[^a-z0-9]/g, "");
    }

    _consonantWakeKey(value) {
      return this._phoneticWakeKey(value)
        .replace(/[aeiou]/g, "")
        .replace(/([a-z0-9])\1+/g, "$1");
    }

    _normalizeWakeCommandText(rawCommand) {
      return String(rawCommand || "")
        .replace(
          /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:do\s+)?/i,
          "",
        )
        .trim();
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
          const baseSensitivity = Math.max(
            0,
            Math.min(1, this.settings.microphoneSensitivity * 0.5),
          );
          const confidenceBoost =
            String(this.settings.commandActivationMode) ===
              String(Rito.ACTIVATION_MODES.WAKE_PHRASE)
              ? 0.14
              : 0.1;
          const minConfidence = Math.max(0, baseSensitivity - confidenceBoost);
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
      const errorCode = event && event.error ? String(event.error) : "unknown";

      // Map error codes to user-friendly descriptions
      const errorDescriptions = {
        "no-speech": "No speech detected - listening paused",
        "audio-capture": "Microphone not working - check your audio settings",
        "network": "Network error - check your internet connection",
        "network-timeout": "Network timeout - please try again",
        "not-allowed": "Microphone permission denied - enable microphone access",
        "service-not-allowed": "Speech recognition service not available in your region",
        "bad-grammar": "Grammar format error",
        "aborted": "Speech recognition was aborted",
      };

      const description = errorDescriptions[errorCode] || `Speech recognition error: ${errorCode}`;

      // Log no-speech as debug to reduce console noise
      if (errorCode === "no-speech") {
        this.logger.debug(`Speech recognition: ${description}`);
      } else {
        this.logger.warn(`Speech recognition error: ${description}`);
      }

      this._emit("error", {
        code: errorCode,
        message: description,
      });

      // Fatal errors - stop attempting restart
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
        this.logger.error("Fatal error - microphone access not available");
        this.shouldRun = false;
        return;
      }

      // Recoverable errors - schedule restart
      if (this.shouldRun && errorCode !== "aborted") {
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
