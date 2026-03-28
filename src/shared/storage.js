(function initRitoStorage(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  function ensureChromeStorage() {
    if (!root.chrome || !chrome.storage || !chrome.storage.sync) {
      throw new Error("Chrome storage API is unavailable in this context.");
    }
  }

  function withDefaults(candidate, defaults) {
    return Object.assign({}, defaults || {}, candidate || {});
  }

  async function getSettings() {
    ensureChromeStorage();
    const key = Rito.STORAGE_KEYS.SETTINGS;
    const result = await chrome.storage.sync.get(key);
    return withDefaults(result[key], Rito.DEFAULT_SETTINGS);
  }

  async function saveSettings(partialSettings) {
    ensureChromeStorage();
    const key = Rito.STORAGE_KEYS.SETTINGS;
    const current = await getSettings();
    const next = Object.assign({}, current, partialSettings || {});
    await chrome.storage.sync.set({ [key]: next });
    return next;
  }

  async function getRuntimeState() {
    ensureChromeStorage();
    const key = Rito.STORAGE_KEYS.RUNTIME_STATE;
    const result = await chrome.storage.session.get(key);
    return withDefaults(result[key], Rito.DEFAULT_RUNTIME_STATE);
  }

  async function saveRuntimeState(partialState) {
    ensureChromeStorage();
    const key = Rito.STORAGE_KEYS.RUNTIME_STATE;
    const current = await getRuntimeState();
    const next = Object.assign({}, current, partialState || {});
    await chrome.storage.session.set({ [key]: next });
    return next;
  }

  function onSettingsChanged(callback) {
    if (!root.chrome || !chrome.storage || !chrome.storage.onChanged) {
      return () => undefined;
    }

    const key = Rito.STORAGE_KEYS.SETTINGS;
    const handler = (changes, area) => {
      if (area !== "sync" || !changes[key]) {
        return;
      }
      const next = withDefaults(changes[key].newValue, Rito.DEFAULT_SETTINGS);
      callback(next);
    };

    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  Rito.storage = {
    getSettings,
    saveSettings,
    getRuntimeState,
    saveRuntimeState,
    onSettingsChanged,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
