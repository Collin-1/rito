// Options page script: lets users set API key via Details -> Extension options.

const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

init();

async function init() {
  const stored = await chrome.storage.local.get([
    "geminiApiKey",
    "openaiApiKey",
  ]);
  const key = stored.geminiApiKey || stored.openaiApiKey;
  if (key) {
    apiKeyInput.value = key;
  }

  saveBtn.addEventListener("click", saveKey);
  testBtn.addEventListener("click", testBackground);
}

async function saveKey() {
  const key = apiKeyInput.value.trim();

  if (!key) {
    setStatus("Please paste an API key first.", true);
    return;
  }

  await chrome.storage.local.set({ openaiApiKey: key });
  await chrome.storage.local.set({ geminiApiKey: key });
  setStatus("API key saved successfully.", false);
}

async function testBackground() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "PING" });
    resultEl.textContent = JSON.stringify(response, null, 2);
    setStatus("Background connection looks good.", false);
  } catch (error) {
    resultEl.textContent = String(error?.message || error);
    setStatus("Could not reach background service worker.", true);
  }
}

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b42318" : "#0f9f78";
}
