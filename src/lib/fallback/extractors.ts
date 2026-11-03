/**
 * Evidence extraction for the Fallback_Engine (Req 4.2, 6.3, 7.3, 10.1).
 *
 * Every returned entry is an exact substring of the Incident_Text: lines are
 * split on `\n`, a trailing `\r` (CRLF input) is dropped, and lines are trimmed,
 * which never introduces characters that are not in the input. Empty entries
 * are dropped and duplicates are removed, keeping the first appearance.
 *
 * All regexes are anchored or bounded and run per line, so extraction is
 * linear in the input length (no catastrophic backtracking).
 */

import type { IncidentType } from '../../shared/analysisContract';

const MERGE_CONFLICT_MARKER = 'Merge conflict in ';
/** `onto <hash>`, hash = 7..40 lowercase hex characters on word boundaries. */
const ONTO_HASH_RE = /\bonto ([0-9a-f]{7,40})\b/g;
/** `<hash> HEAD@{n}: <message>` reflog line (matched against a trimmed line). */
const REFLOG_LINE_RE = /^[0-9a-f]{7,40} HEAD@\{\d+\}: .*$/;

/** Split text into lines, dropping a trailing `\r` so CRLF input stays exact. */
function splitLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** Remove empty strings and duplicates, preserving first appearance. */
export function dedupe(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.length === 0 || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/**
 * Trimmed lines that contain any of the given trigger strings, in line order.
 * With `caseInsensitive`, matching ignores case; the original line text is returned.
 */
export function linesContaining(
  text: string,
  triggers: readonly string[],
  caseInsensitive = false,
): string[] {
  const needles = triggers.filter((t) => t.length > 0).map((t) => (caseInsensitive ? t.toLowerCase() : t));
  if (needles.length === 0) return [];
  const out: string[] = [];
  for (const line of splitLines(text)) {
    const haystack = caseInsensitive ? line.toLowerCase() : line;
    if (needles.some((n) => haystack.includes(n))) {
      const trimmed = line.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return dedupe(out);
}

/** Lines containing `Merge conflict in <path>` and the captured paths (line, then its path). */
export function extractConflictPaths(text: string): { lines: string[]; paths: string[]; entries: string[] } {
  const lines: string[] = [];
  const paths: string[] = [];
  const entries: string[] = [];
  for (const line of splitLines(text)) {
    const idx = line.indexOf(MERGE_CONFLICT_MARKER);
    if (idx === -1) continue;
    const path = line.slice(idx + MERGE_CONFLICT_MARKER.length).trim();
    if (path.length === 0) continue;
    const trimmed = line.trim();
    lines.push(trimmed);
    paths.push(path);
    entries.push(trimmed, path);
  }
  return { lines: dedupe(lines), paths: dedupe(paths), entries: dedupe(entries) };
}

/** Each `onto <hash>` occurrence and its hash (match text, then hash). */
export function extractRebaseOnto(text: string): { matches: string[]; hashes: string[]; entries: string[] } {
  const matches: string[] = [];
  const hashes: string[] = [];
  const entries: string[] = [];
  for (const m of text.matchAll(ONTO_HASH_RE)) {
    matches.push(m[0]);
    hashes.push(m[1]);
    entries.push(m[0], m[1]);
  }
  return { matches: dedupe(matches), hashes: dedupe(hashes), entries: dedupe(entries) };
}

/** Trimmed reflog lines of the form `<hash> HEAD@{n}: <message>`. */
export function extractReflogLines(text: string): string[] {
  const out: string[] = [];
  for (const line of splitLines(text)) {
    const trimmed = line.trim();
    if (REFLOG_LINE_RE.test(trimmed)) out.push(trimmed);
  }
  return dedupe(out);
}

/**
 * Combine the evidence rules from the design for the chosen incident type:
 * trimmed trigger lines first, then type-specific entities.
 * `caseInsensitiveTriggers` are matched ignoring case (lost-commit descriptions).
 */
export function extractEvidence(
  text: string,
  type: IncidentType,
  matchedTriggers: readonly string[],
  caseInsensitiveTriggers: readonly string[] = [],
): string[] {
  const entries: string[] = [
    ...linesContaining(text, matchedTriggers),
    ...linesContaining(text, caseInsensitiveTriggers, true),
  ];
  switch (type) {
    case 'merge_conflict':
      entries.push(...extractConflictPaths(text).entries);
      break;
    case 'stuck_rebase':
      entries.push(...extractRebaseOnto(text).entries);
      break;
    case 'lost_commits':
      entries.push(...extractReflogLines(text));
      break;
    default:
      break;
  }
  return dedupe(entries);
}
