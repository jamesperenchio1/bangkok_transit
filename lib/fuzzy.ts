/**
 * Typo-tolerant matching for the station search. Pure and tiny (no
 * dependency, no data): the keys are the station names and codes the search
 * box already indexes, ~200 of them, so this runs in well under a millisecond
 * per keystroke. Loaded on first use (see components/StationSearch.tsx), so it
 * adds nothing to the first page load.
 *
 * Both sides are expected pre-normalised (lowercase, no spaces/dots/hyphens).
 *
 * A key scores, best first:
 *   0 exact · 1 starts with the query · 2 contains it · 3 the query's letters
 *   appear in order, starting with the same letter ("chtchk" -> chatuchak) ·
 *   4+ a few typos away (one letter wrong, missing or extra; two for long queries).
 */

/** How many typos a query of this length may have: short queries must be exact, or everything matches. */
export function allowedTypos(length: number): number {
  return length <= 3 ? 0 : length <= 5 ? 1 : 2;
}

/** Edit distance between `a` and `b`, giving up (Infinity) once it is certain to exceed `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return Infinity;
    prev = row;
  }
  return prev[b.length];
}

function isSubsequence(q: string, key: string): boolean {
  if (q[0] !== key[0]) return false;
  let at = 0;
  for (const ch of key) if (ch === q[at] && ++at === q.length) return true;
  return false;
}

/** Lower is better; null when `key` does not match `q` at all. */
export function score(q: string, key: string): number | null {
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (key.includes(q)) return 2;
  if (q.length >= 3 && isSubsequence(q, key)) return 3;
  const max = allowedTypos(q.length);
  if (max === 0) return null;
  // The query may be a typo of a whole name, or of just the start of a long one
  // ("phayathi" for "phayathai"): compare against prefixes of nearly its length.
  let best = Infinity;
  for (let len = Math.max(1, q.length - max); len <= Math.min(key.length, q.length + max); len++) {
    best = Math.min(best, editDistance(q, key.slice(0, len), max));
  }
  return best <= max ? 4 + best : null;
}

/**
 * Indexes of the best-matching entries, best first (ties keep their original
 * order, so equal matches stay in line order), at most `limit`. Each entry has
 * several keys (English name, Thai name, code); its score is the best of them.
 */
export function rank(q: string, entries: readonly (readonly string[])[], limit: number): number[] {
  const scored: { index: number; value: number }[] = [];
  entries.forEach((keys, index) => {
    let value = Infinity;
    for (const key of keys) {
      const s = score(q, key);
      if (s !== null && s < value) value = s;
    }
    if (value !== Infinity) scored.push({ index, value });
  });
  scored.sort((a, b) => a.value - b.value || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.index);
}
