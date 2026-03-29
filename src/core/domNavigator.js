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
      const seenElements = new Set();
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
        seenElements.add(element);
      }

      // Include hover-first navigation triggers so numbering works on menus
      // that only become interactive after mouse hover.
      if (candidates.length < opts.maxElements) {
        const hoverCandidates = this.findHoverableByText("", {
          maxResults: Math.min(opts.maxElements, 180),
        });

        for (const hoverCandidate of hoverCandidates) {
          if (candidates.length >= opts.maxElements) {
            break;
          }

          if (!hoverCandidate || !hoverCandidate.element) {
            continue;
          }

          if (seenElements.has(hoverCandidate.element)) {
            continue;
          }

          const rect = hoverCandidate.element.getBoundingClientRect();
          const inViewport =
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < root.innerHeight &&
            rect.left < root.innerWidth;

          if (opts.onlyViewport && !inViewport) {
            continue;
          }

          candidates.push({
            element: hoverCandidate.element,
            text:
              hoverCandidate.text ||
              this._extractElementText(hoverCandidate.element),
            rect,
            inViewport,
            index: candidates.length + 1,
          });
          seenElements.add(hoverCandidate.element);
        }
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

    findHoverableByText(query, options) {
      const opts = Object.assign({ maxResults: 8 }, options || {});
      const cleanedQuery = String(query || "").trim();
      const hoverSelector = [
        "[aria-haspopup='true']",
        "summary",
        "nav a",
        "nav button",
        "[role='button']",
        "[role='menuitem']",
        "button",
        "a[href]",
      ].join(",");

      const nodes = Array.from(root.document.querySelectorAll(hoverSelector));

      // Some navigation menus use plain div/span elements that only react on hover.
      const navContainers = Array.from(
        root.document.querySelectorAll("nav, [role='navigation'], header"),
      );
      const navHoverExtras = [];

      for (const container of navContainers) {
        const descendants = Array.from(
          container.querySelectorAll("div, span, li, p"),
        ).slice(0, 260);

        for (const element of descendants) {
          if (!DOMNavigator.isElementVisible(element)) {
            continue;
          }

          const text = this._extractElementText(element);
          if (!text || text.length > 64) {
            continue;
          }

          const style = root.getComputedStyle(element);
          const className = String(element.className || "").toLowerCase();
          const hasPointerCursor = style.cursor === "pointer";
          const hasHoverSemantic =
            /menu|dropdown|submenu|trigger|hover|nav/.test(className) ||
            element.hasAttribute("aria-haspopup") ||
            element.hasAttribute("aria-expanded") ||
            element.hasAttribute("onmouseenter") ||
            element.hasAttribute("onmouseover") ||
            typeof element.onmouseenter === "function";

          if (hasPointerCursor || hasHoverSemantic) {
            navHoverExtras.push(element);
          }
        }
      }

      const merged = nodes.concat(navHoverExtras);
      const uniqueNodes = [];
      const seen = new Set();
      for (const element of merged) {
        if (!element || seen.has(element)) {
          continue;
        }
        seen.add(element);
        uniqueNodes.push(element);
      }

      const candidates = uniqueNodes
        .filter((element) => DOMNavigator.isElementVisible(element))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const inViewport =
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < root.innerHeight &&
            rect.left < root.innerWidth;
          return {
            element,
            text: this._extractElementText(element),
            rect,
            inViewport,
          };
        });

      if (!cleanedQuery) {
        return candidates
          .sort((left, right) => left.rect.top - right.rect.top)
          .slice(0, opts.maxResults);
      }

      return candidates
        .map((candidate) => {
          const score = Rito.fuzzy.scoreCandidate(cleanedQuery, candidate.text);
          const hasPopupHint =
            candidate.element.hasAttribute("aria-haspopup") ||
            String(candidate.element.className || "")
              .toLowerCase()
              .includes("menu");
          return {
            ...candidate,
            score: score + (hasPopupHint ? 0.08 : 0),
          };
        })
        .filter((candidate) => candidate.score > 0.16)
        .sort((left, right) => right.score - left.score)
        .slice(0, opts.maxResults);
    }

    triggerHover(element) {
      if (!element || !element.isConnected) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const clientX = Math.round(rect.left + Math.min(rect.width / 2, 16));
      const clientY = Math.round(rect.top + Math.min(rect.height / 2, 16));

      const pointerCtor =
        typeof PointerEvent === "function" ? PointerEvent : null;
      const pointerEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        pointerType: "mouse",
      };
      const mouseEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
      };

      try {
        if (pointerCtor) {
          element.dispatchEvent(
            new pointerCtor("pointerover", pointerEventInit),
          );
          element.dispatchEvent(
            new pointerCtor("pointerenter", pointerEventInit),
          );
          element.dispatchEvent(
            new pointerCtor("pointermove", pointerEventInit),
          );
        }

        element.dispatchEvent(new MouseEvent("mouseover", mouseEventInit));
        element.dispatchEvent(new MouseEvent("mouseenter", mouseEventInit));
        element.dispatchEvent(new MouseEvent("mousemove", mouseEventInit));
        element.focus({ preventScroll: true });
        return true;
      } catch (_error) {
        return false;
      }
    }

    async revealByHoverSweep(options) {
      const opts = Object.assign(
        { query: "", maxCandidates: 14, delayMs: 55 },
        options || {},
      );

      const candidates = this.findHoverableByText(opts.query, {
        maxResults: opts.maxCandidates,
      });

      let hovered = 0;
      for (const candidate of candidates) {
        if (!candidate || !candidate.element) {
          continue;
        }

        if (this.triggerHover(candidate.element)) {
          hovered += 1;
          await new Promise((resolve) => {
            root.setTimeout(resolve, opts.delayMs);
          });
        }
      }

      return { hovered, candidates: candidates.length };
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
