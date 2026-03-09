// Background service worker for extension lifecycle and future event routing.

chrome.runtime.onInstalled.addListener(() => {
  console.log("Rito extension installed and ready.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ ok: true, message: "Rito background is alive." });
  }
});
