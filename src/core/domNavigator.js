(function initRitoDomNavigator(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  class DOMNavigator {
    constructor(options) {
      const opts = options || {};
      this.logger = opts.logger || Rito.createLogger("dom");
      this.latestCandidates = [];
    }

    static isElementVisible(element) {
      if (!element || !element.isConnected) {
        return false;
      }

      const style = root.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.pointerEvents === "none"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    }

    static isEditable(element) {
      if (!element) {
        return false;
      }

      const tag = String(element.tagName || "").toLowerCase();
      if (element.isContentEditable) {
        return true;
      }

      if (tag === "textarea") {
        return !element.disabled && !element.readOnly;
      }

      if (tag !== "input") {
        return false;
      }

      const type = String(element.type || "text").toLowerCase();
      const allowedTypes = new Set([
        "text",
        "search",
        "email",
        "url",
        "tel",
        "password",
        "number",
      ]);

      return allowedTypes.has(type) && !element.disabled && !element.readOnly;
    }

    scanInteractiveElements(options) {
      const opts = Object.assign(
        { onlyViewport: true, maxElements: 1200 },
        options || {},
      );
      const selector = Rito.INTERACTIVE_SELECTORS.join(",");
      const nodeList = root.document.querySelectorAll(selector);

      const candidates = [];
      for (
        let i = 0;
        i < nodeList.length && candidates.length < opts.maxElements;
        i += 1
      ) {
        const element = nodeList[i];
        if (!DOMNavigator.isElementVisible(element)) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        const inViewport =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < root.innerHeight &&
          rect.left < root.innerWidth;

        if (opts.onlyViewport && !inViewport) {
          continue;
        }

        const text = this._extractElementText(element);
        candidates.push({
          element,
          text,
          rect,
          inViewport,
          index: candidates.length + 1,
        });
      }

      this.latestCandidates = candidates;
      return candidates;
    }

    findByNumber(number) {
      const index = Number(number);
      if (!Number.isInteger(index) || index < 1) {
        return null;
      }

      const candidate = this.latestCandidates[index - 1];
      return candidate || null;
    }

    findInteractiveByText(query, options) {
      const opts = Object.assign({ maxResults: 5 }, options || {});
      const cleanedQuery = String(query || "").trim();
      const candidates = this.scanInteractiveElements({ onlyViewport: false });

      if (!cleanedQuery) {
        return candidates.slice(0, opts.maxResults);
      }

      const ranked = candidates
        .map((candidate) => {
          const textScore = Rito.fuzzy.scoreCandidate(
            cleanedQuery,
            candidate.text,
          );

          const area = candidate.rect.width * candidate.rect.height;
          const sizeScore = Math.min(1, Math.max(0.1, area / 24000));
          const viewportScore = candidate.inViewport ? 1 : 0.7;

          return {
            ...candidate,
            score: textScore * 0.75 + sizeScore * 0.15 + viewportScore * 0.1,
          };
        })
        .filter((candidate) => candidate.score > 0.18)
        .sort((left, right) => right.score - left.score)
        .slice(0, opts.maxResults);

      return ranked;
    }

    focusBestEditable(hint) {
      const active = root.document.activeElement;
      if (DOMNavigator.isEditable(active)) {
        return active;
      }

      const editable = Array.from(
        root.document.querySelectorAll(
          "input, textarea, [contenteditable='true']",
        ),
      ).filter(
        (element) =>
          DOMNavigator.isElementVisible(element) &&
          DOMNavigator.isEditable(element),
      );

      if (!editable.length) {
        return null;
      }

      if (hint) {
        const ranked = editable
          .map((element) => {
            const descriptor = this._extractElementText(element);
            return {
              element,
              score: Rito.fuzzy.scoreCandidate(hint, descriptor),
            };
          })
          .sort((left, right) => right.score - left.score);

        if (ranked[0] && ranked[0].score > 0.2) {
          ranked[0].element.focus();
          return ranked[0].element;
        }
      }

      editable[0].focus();
      return editable[0];
    }

    _extractElementText(element) {
      const fragments = [
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("title"),
        element.getAttribute("name"),
        element.getAttribute("value"),
        element.getAttribute("alt"),
      ];

      const ariaLabelledBy = element.getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const labelNode = root.document.getElementById(ariaLabelledBy);
        if (labelNode) {
          fragments.push(labelNode.innerText);
        }
      }

      return fragments
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
        .join(" ");
    }
  }

  Rito.DOMNavigator = DOMNavigator;
})(typeof globalThis !== "undefined" ? globalThis : window);
