(function initRitoDebounce(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  function debounce(fn, waitMs) {
    let timeoutId = null;

    return function debounced(...args) {
      const context = this;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(context, args), waitMs);
    };
  }

  function throttle(fn, waitMs) {
    let throttled = false;
    let nextArgs = null;

    function invoke(context, args) {
      fn.apply(context, args);
      throttled = true;
      setTimeout(() => {
        throttled = false;
        if (nextArgs) {
          const pending = nextArgs;
          nextArgs = null;
          invoke(context, pending);
        }
      }, waitMs);
    }

    return function throttledFn(...args) {
      if (!throttled) {
        invoke(this, args);
        return;
      }
      nextArgs = args;
    };
  }

  Rito.timing = {
    debounce,
    throttle,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
