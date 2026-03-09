// Content script: reads and manipulates webpage content for accessibility actions.

const HIGHLIGHT_CLASS = "rito-highlight";
const SIMPLIFIED_CLASS = "rito-simplified-content";

injectStyles();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "EXTRACT_PAGE_TEXT": {
          const text = extractPageText();
          sendResponse({ ok: true, text });
          return;
        }
        case "SCROLL_PAGE": {
          scrollPage(message.direction || "down");
          sendResponse({ ok: true });
          return;
        }
        case "HIGHLIGHT_SENTENCES": {
          const count = highlightSentences(message.sentences || []);
          sendResponse({ ok: true, count });
          return;
        }
        case "REPLACE_PAGE_CONTENT": {
          replacePageContent(message.text || "");
          sendResponse({ ok: true });
          return;
        }
        case "FIND_AND_CLICK": {
          const clicked = findAndClickElement(message.label || "");
          sendResponse(
            clicked
              ? { ok: true }
              : { ok: false, message: "Element not found." },
          );
          return;
        }
        case "START_READING_PAGE": {
          const text = extractPageText();
          if (!text) {
            sendResponse({ ok: false, message: "No readable text found." });
            return;
          }
          startReading(text);
          sendResponse({ ok: true });
          return;
        }
        case "PAUSE_READING": {
          window.speechSynthesis.pause();
          sendResponse({ ok: true });
          return;
        }
        case "RESUME_READING": {
          window.speechSynthesis.resume();
          sendResponse({ ok: true });
          return;
        }
        case "STOP_READING": {
          window.speechSynthesis.cancel();
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, message: "Unknown content action." });
      }
    } catch (error) {
      sendResponse({ ok: false, message: error.message });
    }
  })();

  return true;
});

function getPrimaryContentRoot() {
  return (
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body
  );
}

function extractPageText() {
  const root = getPrimaryContentRoot();
  const raw = root?.innerText || document.body?.innerText || "";
  return raw.replace(/\n{3,}/g, "\n\n").trim();
}

function scrollPage(direction = "down") {
  if (direction === "top") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (direction === "bottom") {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    return;
  }

  const amount = Math.max(window.innerHeight * 0.8, 250);
  const distance = direction === "up" ? -amount : amount;
  window.scrollBy({ top: distance, behavior: "smooth" });
}

function highlightSentences(sentences) {
  if (!Array.isArray(sentences) || !sentences.length) {
    return 0;
  }

  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });

  const candidates = Array.from(
    document.querySelectorAll("p, li, h1, h2, h3, blockquote"),
  );
  let highlighted = 0;

  for (const sentence of sentences) {
    const sample = String(sentence || "")
      .trim()
      .toLowerCase()
      .slice(0, 80);
    if (!sample) {
      continue;
    }

    const match = candidates.find((el) =>
      el.innerText.toLowerCase().includes(sample),
    );
    if (match) {
      match.classList.add(HIGHLIGHT_CLASS);
      highlighted += 1;
    }
  }

  return highlighted;
}

function replacePageContent(newText) {
  const root = getPrimaryContentRoot();
  root.innerHTML = "";

  const wrapper = document.createElement("section");
  wrapper.className = SIMPLIFIED_CLASS;

  const title = document.createElement("h1");
  title.textContent = "Simplified Version";
  wrapper.appendChild(title);

  const paragraphs = String(newText || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    const p = document.createElement("p");
    p.textContent = newText || "No simplified text available.";
    wrapper.appendChild(p);
  } else {
    paragraphs.forEach((paragraph) => {
      const p = document.createElement("p");
      p.textContent = paragraph;
      wrapper.appendChild(p);
    });
  }

  root.appendChild(wrapper);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function findAndClickElement(label) {
  const target = String(label || "")
    .trim()
    .toLowerCase();
  if (!target) {
    return false;
  }

  const selectors = [
    "button",
    "a",
    "input[type='submit']",
    "input[type='button']",
    "[role='button']",
    "[aria-label]",
  ];

  const elements = Array.from(document.querySelectorAll(selectors.join(",")));
  const found = elements.find((el) => {
    const text = [
      el.innerText,
      el.value,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return text.includes(target);
  });

  if (!found) {
    return false;
  }

  found.scrollIntoView({ behavior: "smooth", block: "center" });
  found.click();
  return true;
}

function startReading(text) {
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text.slice(0, 25000));
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function injectStyles() {
  if (document.getElementById("rito-inline-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "rito-inline-style";
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background: linear-gradient(120deg, #fff2b2, #ffd077);
      outline: 2px solid #ffb347;
      border-radius: 4px;
      padding: 2px 3px;
      transition: background 0.2s ease;
    }

    .${SIMPLIFIED_CLASS} {
      max-width: 900px;
      margin: 24px auto;
      padding: 20px;
      line-height: 1.6;
      font-size: 1.1rem;
      background: #fffef6;
      color: #1f1f1f;
      border: 2px solid #f3d37b;
      border-radius: 12px;
    }

    .${SIMPLIFIED_CLASS} h1 {
      margin-top: 0;
      font-size: 1.8rem;
    }
  `;

  document.documentElement.appendChild(style);
}
