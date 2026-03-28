(function initRitoFuzzy(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    const normalized = normalizeText(value);
    return normalized ? normalized.split(" ") : [];
  }

  function levenshteinDistance(a, b) {
    const left = normalizeText(a);
    const right = normalizeText(b);

    if (!left.length) {
      return right.length;
    }
    if (!right.length) {
      return left.length;
    }

    const matrix = Array.from({ length: left.length + 1 }, () =>
      new Array(right.length + 1).fill(0),
    );

    for (let i = 0; i <= left.length; i += 1) {
      matrix[i][0] = i;
    }
    for (let j = 0; j <= right.length; j += 1) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= left.length; i += 1) {
      for (let j = 1; j <= right.length; j += 1) {
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }

    return matrix[left.length][right.length];
  }

  function tokenOverlapScore(query, candidate) {
    const queryTokens = new Set(tokenize(query));
    const candidateTokens = new Set(tokenize(candidate));

    if (!queryTokens.size || !candidateTokens.size) {
      return 0;
    }

    let overlap = 0;
    queryTokens.forEach((token) => {
      if (candidateTokens.has(token)) {
        overlap += 1;
      }
    });

    return overlap / Math.max(queryTokens.size, candidateTokens.size);
  }

  function similarityScore(query, candidate) {
    const left = normalizeText(query);
    const right = normalizeText(candidate);

    if (!left || !right) {
      return 0;
    }

    if (left === right) {
      return 1;
    }

    const containsBonus =
      right.includes(left) || left.includes(right) ? 0.15 : 0;
    const overlap = tokenOverlapScore(left, right);
    const distance = levenshteinDistance(left, right);
    const length = Math.max(left.length, right.length);
    const editScore = length ? 1 - distance / length : 0;

    return Math.max(
      0,
      Math.min(1, overlap * 0.6 + editScore * 0.4 + containsBonus),
    );
  }

  function scoreCandidate(query, candidateText) {
    return similarityScore(query, candidateText);
  }

  Rito.fuzzy = {
    normalizeText,
    tokenize,
    levenshteinDistance,
    tokenOverlapScore,
    similarityScore,
    scoreCandidate,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
