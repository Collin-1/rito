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
  const saved = await chrome.storage.local.get(["openaiApiKey"]);
  if (saved.openaiApiKey) {
    elements.apiKey.value = saved.openaiApiKey;
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
  await chrome.storage.local.set({ openaiApiKey: key });
  setStatus("API key saved.", "success");
}

export async function startSpeechRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus("Speech recognition is not supported in this browser.", "error");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;

  // Auto mode keeps a broad default and lets AI detect/translate the transcript.
  const selectedLang = elements.voiceLang.value;
  recognition.lang = selectedLang === "auto" ? "en-US" : selectedLang;

  elements.micBtn.disabled = true;
  elements.micBtn.textContent = "Listening...";
  setStatus("Listening for your command...", "");

  try {
    // Trigger the browser microphone permission flow for reliable recognition.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    elements.micBtn.disabled = false;
    elements.micBtn.textContent = "Start Voice";
    setStatus(
      "Microphone permission blocked. Allow mic access in site settings.",
      "error",
    );
    elements.aiResponse.textContent = `Mic permission error: ${error.message}`;
    return;
  }

  recognition.onresult = async (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
    elements.transcript.textContent = transcript || "No speech detected.";

    if (transcript) {
      await handleVoiceCommand(transcript);
    }
  };

  recognition.onerror = (event) => {
    const msg = `Speech error: ${event.error}. Try typing the command below.`;
    setStatus(msg, "error");
    elements.aiResponse.textContent = msg;
  };

  recognition.onend = () => {
    elements.micBtn.disabled = false;
    elements.micBtn.textContent = "Start Voice";
  };

  try {
    recognition.start();
  } catch (error) {
    elements.micBtn.disabled = false;
    elements.micBtn.textContent = "Start Voice";
    setStatus(`Could not start speech recognition: ${error.message}`, "error");
    elements.aiResponse.textContent =
      "Voice capture could not start. Use the text command fallback to continue demo.";
  }
}

async function handleVoiceCommand(transcript) {
  try {
    setStatus("Understanding your command...", "");

    const intent = await parseIntent(transcript);
    const metadata = `Language: ${intent.detected_language} | Interpreted: ${intent.english_command}`;

    const actionResult = await executeAction(intent);

    if (actionResult.summary) {
      latestSummary = actionResult.summary;
    }

    elements.aiResponse.textContent = `${metadata}\n\n${actionResult.message}`;
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
