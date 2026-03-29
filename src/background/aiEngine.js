(function initRitoAiEngine(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  const API_URL = "https://api.groq.com/openai/v1/chat/completions";
  const DEFAULT_TIMEOUT_MS = 12000;

  const SUPPORTED_ACTIONS = new Set([
    "OPEN_URL",
    "SEARCH",
    "CLICK",
    "FIND_TOPIC",
    "SCROLL",
    "TYPE",
    "SWITCH_TAB",
    "CLOSE_TAB",
    "SUMMARIZE_PAGE",
    "MULTI_STEP",
  ]);

  const intentCache = new Map();
  const summaryCache = new Map();
  const inflightIntent = new Map();
  const recentIntentCalls = new Map();

  function normalizeAction(action) {
    return String(action || "")
      .trim()
      .toUpperCase();
  }

  function toSafeString(value, fallback) {
    const output = String(value || "").trim();
    if (output) {
      return output;
    }
    return fallback || "";
  }

  function sanitizeContext(rawContext) {
    const context = rawContext || {};
    return {
      url: toSafeString(context.url, ""),
      title: toSafeString(context.title, ""),
      visibleText: toSafeString(context.visibleText, "").slice(0, 2000),
    };
  }

  function stableHash(input) {
    let hash = 0;
    const text = String(input || "");
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  function createIntentCacheKey(transcript, context, model) {
    const safeContext = sanitizeContext(context);
    return [
      stableHash(transcript),
      stableHash(safeContext.url),
      stableHash(safeContext.title),
      stableHash(safeContext.visibleText),
      stableHash(model),
    ].join("|");
  }

  function createSummaryCacheKey(context, model) {
    const safeContext = sanitizeContext(context);
    return [
      stableHash(safeContext.url),
      stableHash(safeContext.title),
      stableHash(safeContext.visibleText),
      stableHash(model),
    ].join("|");
  }

  function stripMarkdownCodeFence(text) {
    const value = String(text || "").trim();
    const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
      return fenced[1].trim();
    }
    return value;
  }

  function extractLikelyJsonObject(text) {
    const cleaned = stripMarkdownCodeFence(text);
    if (!cleaned) {
      return "";
    }

    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
      return cleaned;
    }

    const start = cleaned.indexOf("{");
    if (start === -1) {
      return "";
    }

    let depth = 0;
    for (let i = start; i < cleaned.length; i += 1) {
      const char = cleaned[i];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return cleaned.slice(start, i + 1);
        }
      }
    }

    return "";
  }

  function parseJsonStrict(text) {
    const candidate = extractLikelyJsonObject(text);
    if (!candidate) {
      return null;
    }

    try {
      return JSON.parse(candidate);
    } catch (_error) {
      return null;
    }
  }

  function normalizeStep(step) {
    if (!step || typeof step !== "object") {
      return null;
    }

    const action = normalizeAction(step.action);
    if (!SUPPORTED_ACTIONS.has(action) || action === "MULTI_STEP") {
      return null;
    }

    const normalized = {
      action,
      target: toSafeString(step.target, ""),
      value: toSafeString(step.value || step.query || "", ""),
      url: toSafeString(step.url, ""),
    };

    if (step.direction) {
      normalized.direction = toSafeString(step.direction, "").toLowerCase();
    }

    if (step.amount !== undefined) {
      const amount = Number(step.amount);
      if (Number.isFinite(amount) && amount > 0) {
        normalized.amount = amount;
      }
    }

    if (step.index !== undefined) {
      const index = Number(step.index);
      if (Number.isFinite(index) && index > 0) {
        normalized.index = Math.floor(index);
      }
    }

    if (step.newTab !== undefined) {
      normalized.newTab = Boolean(step.newTab);
    }

    return normalized;
  }

  function normalizeIntent(rawIntent) {
    if (!rawIntent || typeof rawIntent !== "object") {
      return null;
    }

    const action = normalizeAction(rawIntent.action);
    if (!SUPPORTED_ACTIONS.has(action)) {
      return null;
    }

    if (action === "MULTI_STEP") {
      const steps = Array.isArray(rawIntent.steps)
        ? rawIntent.steps.map((step) => normalizeStep(step)).filter(Boolean)
        : [];
      if (!steps.length) {
        return null;
      }
      return { action, steps };
    }

    const normalized = normalizeStep(rawIntent);
    if (!normalized) {
      return null;
    }

    return normalized;
  }

  function normalizeSummary(rawSummary) {
    if (!rawSummary || typeof rawSummary !== "object") {
      return null;
    }

    const summary = toSafeString(rawSummary.summary, "");
    const keyPoints = Array.isArray(rawSummary.keyPoints)
      ? rawSummary.keyPoints
          .map((point) => toSafeString(point, ""))
          .filter(Boolean)
          .slice(0, 7)
      : [];

    if (!summary) {
      return null;
    }

    return { summary, keyPoints };
  }

  async function callGroq(payload) {
    const body = payload || {};
    const timeoutMs = Math.max(
      3000,
      Number(body.timeoutMs || DEFAULT_TIMEOUT_MS),
    );

    const controller = new AbortController();
    const timeoutId = root.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${body.apiKey}`,
        },
        body: JSON.stringify({
          model: body.model || "llama-3.3-70b-versatile",
          temperature: body.temperature !== undefined ? body.temperature : 0,
          messages: body.messages || [],
          max_tokens: body.maxTokens || 800,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(
          `Groq request failed (${response.status}): ${String(
            responseText || "",
          )
            .slice(0, 220)
            .trim()}`,
        );
      }

      const json = await response.json();
      const message =
        json &&
        json.choices &&
        json.choices[0] &&
        json.choices[0].message &&
        json.choices[0].message.content;

      const content = String(message || "").trim();
      if (!content) {
        throw new Error("Groq returned an empty completion.");
      }

      return content;
    } finally {
      root.clearTimeout(timeoutId);
    }
  }

  function buildIntentSystemPrompt() {
    return [
      "You are an AI assistant that converts natural language into browser automation commands.",
      "Return ONLY valid JSON.",
      "Supported actions:",
      "- OPEN_URL",
      "- SEARCH",
      "- CLICK",
      "- FIND_TOPIC",
      "- SCROLL",
      "- TYPE",
      "- SWITCH_TAB",
      "- CLOSE_TAB",
      "- SUMMARIZE_PAGE",
      "Format:",
      "{",
      '  "action": "ACTION_NAME",',
      '  "target": "optional",',
      '  "value": "optional",',
      '  "url": "optional",',
      '  "steps": []',
      "}",
      "If multiple steps are needed, return:",
      "{",
      '  "action": "MULTI_STEP",',
      '  "steps": [',
      '    { "action": "...", "target": "..." }',
      "  ]",
      "}",
      "Never add markdown, comments, or prose.",
      "If the user asks where to find a topic on the current page, return FIND_TOPIC with target set to that topic.",
      "For page-local discovery requests, prefer FIND_TOPIC over SEARCH and OPEN_URL.",
      "If unsure, return the most likely single supported action as JSON.",
    ].join("\n");
  }

  function buildIntentUserPrompt(transcript, context) {
    const safeContext = sanitizeContext(context);
    return JSON.stringify(
      {
        transcript: toSafeString(transcript, ""),
        context: safeContext,
      },
      null,
      2,
    );
  }

  function buildSummarySystemPrompt() {
    return [
      "You summarize web page content for voice assistant users.",
      "Return ONLY valid JSON with this format:",
      "{",
      '  "summary": "short summary",',
      '  "keyPoints": ["point 1", "point 2", "point 3"]',
      "}",
      "Keep key points concise and actionable.",
      "Do not include markdown.",
    ].join("\n");
  }

  function buildSummaryUserPrompt(context) {
    return JSON.stringify(
      {
        context: sanitizeContext(context),
      },
      null,
      2,
    );
  }

  async function parseIntent(options) {
    const opts = options || {};
    const transcript = toSafeString(opts.transcript, "");
    const context = sanitizeContext(opts.context);
    const model = toSafeString(opts.model, "llama-3.3-70b-versatile");
    const cacheTtlMs = Math.max(3000, Number(opts.cacheTtlMs || 45000));
    const debounceMs = Math.max(100, Number(opts.debounceMs || 450));

    if (!transcript) {
      return { intent: null, source: "empty" };
    }

    const cacheKey = createIntentCacheKey(transcript, context, model);
    const now = Date.now();
    const cached = intentCache.get(cacheKey);
    if (cached && now - cached.timestamp < cacheTtlMs) {
      return { intent: cached.intent, source: "cache" };
    }

    if (inflightIntent.has(cacheKey)) {
      return inflightIntent.get(cacheKey);
    }

    const lastCallAt = recentIntentCalls.get(cacheKey) || 0;
    if (now - lastCallAt < debounceMs && cached) {
      return { intent: cached.intent, source: "debounced_cache" };
    }
    recentIntentCalls.set(cacheKey, now);

    const job = (async () => {
      const completion = await callGroq({
        apiKey: opts.apiKey,
        model,
        timeoutMs: opts.timeoutMs,
        maxTokens: 700,
        temperature: 0,
        messages: [
          { role: "system", content: buildIntentSystemPrompt() },
          {
            role: "user",
            content: buildIntentUserPrompt(transcript, context),
          },
        ],
      });

      const parsed = parseJsonStrict(completion);
      const normalized = normalizeIntent(parsed);
      if (!normalized) {
        return { intent: null, source: "invalid_json" };
      }

      intentCache.set(cacheKey, {
        intent: normalized,
        timestamp: Date.now(),
      });

      return { intent: normalized, source: "network" };
    })().finally(() => {
      inflightIntent.delete(cacheKey);
    });

    inflightIntent.set(cacheKey, job);
    return job;
  }

  async function summarizePage(options) {
    const opts = options || {};
    const context = sanitizeContext(opts.context);
    const model = toSafeString(opts.model, "llama-3.3-70b-versatile");
    const cacheTtlMs = Math.max(5000, Number(opts.cacheTtlMs || 60000));

    const cacheKey = createSummaryCacheKey(context, model);
    const now = Date.now();
    const cached = summaryCache.get(cacheKey);
    if (cached && now - cached.timestamp < cacheTtlMs) {
      return { summary: cached.value, source: "cache" };
    }

    const completion = await callGroq({
      apiKey: opts.apiKey,
      model,
      timeoutMs: opts.timeoutMs,
      maxTokens: 900,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildSummarySystemPrompt() },
        {
          role: "user",
          content: buildSummaryUserPrompt(context),
        },
      ],
    });

    const parsed = parseJsonStrict(completion);
    const normalized = normalizeSummary(parsed);
    if (!normalized) {
      return {
        summary: {
          summary: "I could not generate a structured summary for this page.",
          keyPoints: [],
        },
        source: "invalid_json",
      };
    }

    summaryCache.set(cacheKey, {
      value: normalized,
      timestamp: Date.now(),
    });

    return { summary: normalized, source: "network" };
  }

  function clearCache() {
    intentCache.clear();
    summaryCache.clear();
    inflightIntent.clear();
    recentIntentCalls.clear();
  }

  Rito.aiEngine = {
    parseIntent,
    summarizePage,
    clearCache,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
