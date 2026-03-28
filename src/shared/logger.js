(function initRitoLogger(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  class Logger {
    constructor(context) {
      this.context = context || "rito";
      this.debugEnabled = false;
    }

    setDebugEnabled(enabled) {
      this.debugEnabled = Boolean(enabled);
    }

    _prefix(level) {
      return `[Rito:${this.context}:${level}]`;
    }

    debug(...args) {
      if (!this.debugEnabled) {
        return;
      }
      console.debug(this._prefix("debug"), ...args);
    }

    info(...args) {
      console.info(this._prefix("info"), ...args);
    }

    warn(...args) {
      console.warn(this._prefix("warn"), ...args);
    }

    error(...args) {
      console.error(this._prefix("error"), ...args);
    }
  }

  Rito.createLogger = function createLogger(context) {
    return new Logger(context);
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
