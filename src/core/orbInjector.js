(function initRitoOrbInjector(globalScope) {
    const root = globalScope || globalThis;
    const Rito = (root.Rito = root.Rito || {});

    class OrbInjector {
        constructor(options) {
            const opts = options || {};
            this.logger = opts.logger || Rito.createLogger("orb");
            this.settings = opts.settings || {};
            this.container = null;
            this.canvas = null;
            this.ctx = null;
            this.state = "idle";
            this.isInjected = false;

            // Animation state
            this.t = 0;
            this.cfg = { nLines: 18, wobble: 9, speed: 3, glow: 4 };
            this.cur = { amp: 0.45, spd: 0.5, hue0: 175, hue1: 230 };

            // Voice responsiveness
            this.analyser = null;
            this.micStream = null;
            this.micActive = false;
            this.smoothAmp = 0;
            this.voiceAmpModifier = 1;
            this.silenceTimer = null;
            const SPEECH_THRESHOLD = 0.08;
            this.SPEECH_THRESHOLD = SPEECH_THRESHOLD;
            const SILENCE_DURATION = 600;
            this.SILENCE_DURATION = SILENCE_DURATION;

            this.STATES = {
                idle: { ampMul: 0.45, spdMul: 0.5, hue0: 175, hue1: 230, label: "● idle" },
                listening: { ampMul: 0.85, spdMul: 1.2, hue0: 160, hue1: 210, label: "◎ listening" },
                speaking: { ampMul: 1.7, spdMul: 2.6, hue0: 180, hue1: 260, label: "▶ speaking" },
                thinking: { ampMul: 0.7, spdMul: 0.75, hue0: 200, hue1: 280, label: "… thinking" },
            };
        }

        inject() {
            if (this.isInjected) {
                return;
            }

            try {
                // Create container
                this.container = document.createElement("div");
                this.container.id = "rito-orb-container";
                this.container.style.cssText = `
          position: fixed;
          bottom: 24px;
          right: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          z-index: 999999;
          font-family: monospace;
        `;

                // Create canvas
                this.canvas = document.createElement("canvas");
                this.canvas.id = "rito-orb-canvas";
                this.canvas.width = 208;
                this.canvas.height = 208;
                this.canvas.style.cssText = `
          display: block;
          cursor: pointer;
          border-radius: 50%;
          box-shadow: 0 8px 32px rgba(0, 200, 255, 0.3);
        `;

                // Create status label
                const status = document.createElement("div");
                status.id = "rito-orb-status";
                status.style.cssText = `
          font-size: 11px;
          color: #2299bb;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-align: center;
        `;
                status.textContent = "● idle";

                // Create toggle button
                const btn = document.createElement("button");
                btn.id = "rito-orb-mic-btn";
                btn.textContent = "🎙 Activate";
                btn.style.cssText = `
          font-size: 12px;
          padding: 8px 16px;
          border-radius: 20px;
          border: 1px solid #1a3344;
          background: rgba(0, 50, 100, 0.3);
          color: #4499bb;
          cursor: pointer;
          font-family: monospace;
          letter-spacing: 0.06em;
          transition: all 0.2s;
        `;
                btn.addEventListener("mouseenter", () => {
                    btn.style.borderColor = "#00aadd";
                    btn.style.color = "#00ddff";
                    btn.style.background = "rgba(0, 100, 150, 0.4)";
                });
                btn.addEventListener("mouseleave", () => {
                    if (!this.micActive) {
                        btn.style.borderColor = "#1a3344";
                        btn.style.color = "#4499bb";
                        btn.style.background = "rgba(0, 50, 100, 0.3)";
                    }
                });
                btn.addEventListener("click", () => this.toggleMicrophone());

                this.container.appendChild(this.canvas);
                this.container.appendChild(status);
                this.container.appendChild(btn);
                document.body.appendChild(this.container);

                this.ctx = this.canvas.getContext("2d");
                this.canvas.addEventListener("click", () => this.toggleMicrophone());

                this.isInjected = true;
                this.logger.debug("Orb injected into page");
                this._startAnimation();
            } catch (error) {
                this.logger.error("Failed to inject orb", error);
            }
        }

        setState(newState) {
            if (newState && this.STATES[newState]) {
                this.state = newState;
                const statusEl = document.getElementById("rito-orb-status");
                if (statusEl) {
                    statusEl.textContent = this.STATES[newState].label;
                }
            }
        }

        setStateFromOrb(newState) {
            // Allow external control of orb state (from speechEngine)
            this.setState(newState);
        }

        async toggleMicrophone() {
            if (this.micActive) {
                await this._stopMicrophone();
            } else {
                await this._startMicrophone();
            }
        }

        async _startMicrophone() {
            try {
                this.micStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false,
                });
                const AudioContext = root.AudioContext || root.webkitAudioContext;
                const audioCtx = new AudioContext();
                const source = audioCtx.createMediaStreamSource(this.micStream);
                this.analyser = audioCtx.createAnalyser();
                this.analyser.fftSize = 256;
                this.analyser.smoothingTimeConstant = 0.75;
                source.connect(this.analyser);
                this.micActive = true;
                this.setState("listening");

                const btn = document.getElementById("rito-orb-mic-btn");
                if (btn) {
                    btn.textContent = "🔴 Active";
                    btn.style.borderColor = "#00ccff";
                    btn.style.color = "#00ffff";
                    btn.style.background = "rgba(0, 200, 255, 0.15)";
                }

                this.logger.debug("Microphone started");
            } catch (error) {
                this.logger.error("Microphone access denied", error);
                alert("Microphone access required");
            }
        }

        async _stopMicrophone() {
            if (this.micStream) {
                this.micStream.getTracks().forEach((track) => {
                    track.stop();
                });
            }
            this.analyser = null;
            this.micStream = null;
            this.micActive = false;
            this.smoothAmp = 0;
            this.voiceAmpModifier = 1;
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
            this.setState("idle");

            const btn = document.getElementById("rito-orb-mic-btn");
            if (btn) {
                btn.textContent = "🎙 Activate";
                btn.style.borderColor = "#1a3344";
                btn.style.color = "#4499bb";
                btn.style.background = "rgba(0, 50, 100, 0.3)";
            }

            this.logger.debug("Microphone stopped");
        }

        _getAudioAmplitude() {
            if (!this.analyser) return 0;
            const dataArr = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteTimeDomainData(dataArr);

            let sum = 0;
            for (let i = 0; i < dataArr.length; i++) {
                const normalized = (dataArr[i] / 128) - 1;
                sum += normalized * normalized;
            }
            const rms = Math.sqrt(sum / dataArr.length);
            return Math.min(rms * 8, 1);
        }

        _updateVoiceState() {
            if (!this.micActive) return;

            const rawAmp = this._getAudioAmplitude();
            const lerpK = rawAmp > this.smoothAmp ? 0.3 : 0.06;
            this.smoothAmp = this._lerp(this.smoothAmp, rawAmp, lerpK);
            this.voiceAmpModifier = 1 + this.smoothAmp * 2;

            if (this.smoothAmp > this.SPEECH_THRESHOLD) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
                if (this.state !== "speaking") {
                    this.setState("speaking");
                }
            } else {
                if (!this.silenceTimer && this.state === "speaking") {
                    this.silenceTimer = setTimeout(() => {
                        this.setState("listening");
                        this.silenceTimer = null;
                    }, this.SILENCE_DURATION);
                }
            }
        }

        _lerp(a, b, k) {
            return a + (b - a) * k;
        }

        _seismicPath(ringR, lineSpacing, lineIdx, amplitude, timeOffset) {
            const N = 220;
            const pts = [];
            const r = ringR + lineIdx * lineSpacing;
            const CX = this.canvas.width / 2;
            const CY = this.canvas.height / 2;

            for (let i = 0; i <= N; i++) {
                const angle = (i / N) * Math.PI * 2;
                const w =
                    Math.sin(angle * 4 + timeOffset * 1.1) * amplitude * 0.4 +
                    Math.sin(angle * 7 - timeOffset * 0.85) * amplitude * 0.25 +
                    Math.sin(angle * 11 + timeOffset * 1.5) * amplitude * 0.15 +
                    Math.sin(angle * 2 - timeOffset * 0.55) * amplitude * 0.2 +
                    Math.sin(angle * 17 + timeOffset * 2.1) * amplitude * 0.08 +
                    Math.sin(angle * 6 + timeOffset * 0.4 + lineIdx * 0.3) * amplitude * 0.18;

                const rr = r + w;
                pts.push([
                    CX + Math.cos(angle) * rr,
                    CY + Math.sin(angle) * rr,
                ]);
            }
            return pts;
        }

        _hsl(h, s, l, a) {
            return `hsla(${h},${s}%,${l}%,${a})`;
        }

        _draw() {
            if (!this.isInjected || !this.ctx) return;

            this._updateVoiceState();

            const tgt = this.STATES[this.state];
            const k = 0.04;
            this.cur.amp = this._lerp(this.cur.amp, tgt.ampMul, k);
            this.cur.spd = this._lerp(this.cur.spd, tgt.spdMul, k);
            this.cur.hue0 = this._lerp(this.cur.hue0, tgt.hue0, k);
            this.cur.hue1 = this._lerp(this.cur.hue1, tgt.hue1, k);

            this.t += 0.012 * this.cfg.speed * this.cur.spd;

            const W = this.canvas.width;
            const H = this.canvas.height;

            // Background removed - transparent orb
            this.ctx.clearRect(0, 0, W, H);

            const nL = this.cfg.nLines;
            const innerR = 44;
            const outerR = 84;
            const bandW = outerR - innerR;
            const spacing = bandW / (nL - 1);
            const amplitude = this.cfg.wobble * this.cur.amp * this.voiceAmpModifier;
            const glowStr = this.cfg.glow / 5;

            for (let li = 0; li < nL; li++) {
                const frac = li / (nL - 1);
                const hue = this._lerp(this.cur.hue0, this.cur.hue1, frac);
                const edge = 1 - Math.abs(frac - 0.5) * 2;
                const light = this._lerp(65, 30, edge * 0.55);
                const alpha = this._lerp(0.9, 0.35, edge * 0.6);
                const tOff = this.t + li * 0.18;
                const pts = this._seismicPath(innerR, spacing, li, amplitude, tOff);

                this.ctx.beginPath();
                pts.forEach(([x, y], i) =>
                    i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y)
                );
                this.ctx.closePath();
                this.ctx.strokeStyle = this._hsl(hue, 100, 70, alpha * 0.18 * glowStr);
                this.ctx.lineWidth = 3.5;
                this.ctx.stroke();

                this.ctx.beginPath();
                pts.forEach(([x, y], i) =>
                    i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y)
                );
                this.ctx.closePath();
                this.ctx.strokeStyle = this._hsl(hue, 95, light, alpha);
                this.ctx.lineWidth = 0.75;
                this.ctx.stroke();
            }

            const CX = W / 2;
            const CY = H / 2;
            const glowPasses = [
                { angle: -Math.PI / 2, hue: 180, r: 60 },
                { angle: Math.PI * 0.15, hue: 210, r: 60 },
                { angle: Math.PI * 0.85, hue: 245, r: 60 },
            ];

            glowPasses.forEach(({ angle, hue, r }) => {
                const bx = CX + Math.cos(angle) * r;
                const by = CY + Math.sin(angle) * r;
                const bloom = this.ctx.createRadialGradient(bx, by, 0, bx, by, 28 * glowStr);
                bloom.addColorStop(0, this._hsl(hue, 100, 80, 0.13 * glowStr));
                bloom.addColorStop(1, this._hsl(hue, 100, 60, 0));
                this.ctx.fillStyle = bloom;
                this.ctx.beginPath();
                this.ctx.arc(bx, by, 28 * glowStr, 0, Math.PI * 2);
                this.ctx.fill();
            });

            requestAnimationFrame(() => this._draw());
        }

        _startAnimation() {
            this._draw();
        }
    }

    Rito.OrbInjector = OrbInjector;
})(typeof globalThis !== "undefined" ? globalThis : window);
