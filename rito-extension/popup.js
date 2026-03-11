// Popup controller: captures voice, calls AI parser, executes actions, and updates UI.

import { parseIntent } from "./ai.js";
import {
  executeAction,
  highlight_important_points,
  pauseReading,
  read_page,
  readTextAloud,
  resumeReading,
  simplify_page,
  stopReading,
  summarize_page,
} from "./actions.js";

const elements = {
  apiKey: document.getElementById("apiKey"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  micBtn: document.getElementById("micBtn"),
  manualCommand: document.getElementById("manualCommand"),
  runCommandBtn: document.getElementById("runCommandBtn"),
  voiceLang: document.getElementById("voiceLang"),
  transcript: document.getElementById("transcript"),
  aiResponse: document.getElementById("aiResponse"),
  summarizeBtn: document.getElementById("summarizeBtn"),
  readBtn: document.getElementById("readBtn"),
  simplifyBtn: document.getElementById("simplifyBtn"),
  highlightBtn: document.getElementById("highlightBtn"),
  readSummaryBtn: document.getElementById("readSummaryBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  status: document.getElementById("status"),
};

let latestSummary = "";

init();

async function init() {
  const saved = await chrome.storage.local.get(["groqApiKey"]);
  const key = saved.groqApiKey;
  if (key) {
    elements.apiKey.value = key;
  }

  elements.saveKeyBtn.addEventListener("click", saveApiKey);
  elements.micBtn.addEventListener("click", startSpeechRecognition);
  elements.runCommandBtn.addEventListener("click", async () => {
    const command = elements.manualCommand.value.trim();
    if (!command) {
      setStatus("Type a command first.", "error");
      return;
    }

    elements.transcript.textContent = command;
    await handleVoiceCommand(command);
  });

  elements.summarizeBtn.addEventListener("click", async () => {
    await runAction(summarize_page);
  });

  elements.readBtn.addEventListener("click", async () => {
    await runAction(read_page);
  });

  elements.simplifyBtn.addEventListener("click", async () => {
    await runAction(simplify_page);
  });

  elements.highlightBtn.addEventListener("click", async () => {
    await runAction(highlight_important_points);
  });

  elements.readSummaryBtn.addEventListener("click", () => {
    const result = readTextAloud(
      latestSummary || elements.aiResponse.textContent,
    );
    setStatus(result.message, result.ok ? "success" : "error");
  });

  elements.pauseBtn.addEventListener("click", async () => {
    await runAction(pauseReading);
  });

  elements.resumeBtn.addEventListener("click", async () => {
    await runAction(resumeReading);
  });

  elements.stopBtn.addEventListener("click", async () => {
    await runAction(stopReading);
  });
}

async function saveApiKey() {
  const key = elements.apiKey.value.trim();
  await chrome.storage.local.set({ groqApiKey: key });
  setStatus("API key saved.", "success");
}

export async function startSpeechRecognition() {
  const selectedLang = elements.voiceLang.value;
  const lang = selectedLang === "auto" ? "en-US" : selectedLang;

  elements.micBtn.disabled = true;
  elements.micBtn.textContent = "Listening...";
  setStatus("Listening on the current page...", "");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    if (isRestrictedUrl(tab.url)) {
      throw new Error(
        "Voice capture cannot run on this page. Open a normal website tab and try again.",
      );
    }

    const response = await sendMessageWithAutoInject(tab.id, {
      type: "CAPTURE_VOICE_COMMAND",
      lang,
    });

    if (!response?.ok) {
      throw new Error(
        response?.message || "Voice capture failed on this page.",
      );
    }

    const transcript = String(response.transcript || "").trim();
    elements.transcript.textContent = transcript || "No speech detected.";

    if (!transcript) {
      setStatus("No speech detected. Try again.", "error");
      return;
    }

    await handleVoiceCommand(transcript);
  } catch (error) {
    setStatus(`Could not start voice capture: ${error.message}`, "error");
    elements.aiResponse.textContent =
      "Voice capture could not start on this tab. Use the text command fallback to continue demo.";
  } finally {
    elements.micBtn.disabled = false;
    elements.micBtn.textContent = "Start Voice";
  }
}

async function sendMessageWithAutoInject(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const text = String(error?.message || error);

    if (!text.includes("Receiving end does not exist")) {
      throw error;
    }

    // Inject content script into already-open pages, then retry message once.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    return chrome.tabs.sendMessage(tabId, message);
  }
}

function isRestrictedUrl(url) {
  const value = String(url || "");
  return (
    value.startsWith("chrome://") ||
    value.startsWith("edge://") ||
    value.startsWith("about:") ||
    value.startsWith("chrome-extension://")
  );
}

async function handleVoiceCommand(transcript) {
  try {
    setStatus("Understanding your command...", "");

    const intent = await parseIntent(transcript);
    const metadata = `Language: ${intent.detected_language} | Interpreted: ${intent.english_command}`;
    const fallbackNote = intent.fallback_note
      ? `\nMode: ${intent.fallback_note}`
      : "";

    const actionResult = await executeAction(intent);

    if (actionResult.summary) {
      latestSummary = actionResult.summary;
    }

    elements.aiResponse.textContent = `${metadata}${fallbackNote}\n\n${actionResult.message}`;
    setStatus(
      actionResult.ok ? "Action completed." : "Action not completed.",
      actionResult.ok ? "success" : "error",
    );
  } catch (error) {
    elements.aiResponse.textContent = `Error: ${error.message}`;
    setStatus("Failed to process command.", "error");
  }
}

async function runAction(actionFn) {
  try {
    setStatus("Working...", "");
    const result = await actionFn();

    if (result.summary) {
      latestSummary = result.summary;
    }

    if (result.simplified) {
      elements.aiResponse.textContent = result.simplified;
    } else {
      elements.aiResponse.textContent = result.message;
    }

    setStatus(
      result.ok ? "Done." : "Could not complete action.",
      result.ok ? "success" : "error",
    );
  } catch (error) {
    elements.aiResponse.textContent = `Error: ${error.message}`;
    setStatus("Action failed.", "error");
  }
}

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.classList.remove("error", "success");

  if (type) {
    elements.status.classList.add(type);
  }
}
