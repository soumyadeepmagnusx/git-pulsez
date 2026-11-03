/**
 * Fallback_Engine trigger patterns (design: "Fallback_Engine" → "Trigger patterns").
 *
 * All checks are plain substring searches (linear time). Triggers are
 * case-sensitive except the plain-language lost-commit descriptions.
 */

import type { SupportedIncidentType } from '../../shared/analysisContract';

/** Fixed priority order used when more than one type matches (Req 8.4). */
export const PRIORITY: readonly SupportedIncidentType[] = [
  'stuck_rebase',
  'merge_conflict',
  'lost_commits',
  'detached_head',
  'rejected_push',
];

/** One trigger string and whether it is matched case-insensitively. */
export interface Trigger {
  text: string;
  caseInsensitive: boolean;
}

const cs = (text: string): Trigger => ({ text, caseInsensitive: false });
const ci = (text: string): Trigger => ({ text, caseInsensitive: true });

/** `rejected_push` needs `[rejected]` AND one of these (Req 3.1). */
export const REJECTED_MARKER: Trigger = cs('[rejected]');
export const REJECTED_REASONS: readonly Trigger[] = [
  cs('non-fast-forward'),
  cs('fetch first'),
  cs('Updates were rejected'),
];

/** Any-of triggers for the remaining types (Req 4.1, 5.1, 6.1, 7.1). */
export const ANY_OF_TRIGGERS: Readonly<Record<Exclude<SupportedIncidentType, 'rejected_push'>, readonly Trigger[]>> = {
  merge_conflict: [cs('CONFLICT ('), cs('Automatic merge failed'), cs('fix conflicts and then commit')],
  detached_head: [cs('detached HEAD'), cs('HEAD detached at'), cs('HEAD detached from')],
  stuck_rebase: [
    cs('rebase in progress'),
    cs('interactive rebase in progress'),
    cs('git rebase --continue'),
    cs('could not apply'),
  ],
  lost_commits: [
    cs('reset: moving to'),
    cs('HEAD@{'),
    cs('git reset --hard'),
    ci('lost commit'),
    ci('lost my commit'),
    ci('commits are gone'),
    ci('commits disappeared'),
    ci('commit disappeared'),
    ci('undo a reset'),
    ci('undo reset'),
  ],
};

/** True when `haystack` contains the trigger, honoring its case sensitivity. */
export function containsTrigger(haystack: string, trigger: Trigger): boolean {
  return trigger.caseInsensitive
    ? haystack.toLowerCase().includes(trigger.text.toLowerCase())
    : haystack.includes(trigger.text);
}

/** All triggers of `type` found in `text`; empty when the type does not match. */
export function matchedTriggerSpecs(text: string, type: SupportedIncidentType): Trigger[] {
  if (type === 'rejected_push') {
    if (!containsTrigger(text, REJECTED_MARKER)) return [];
    const reasons = REJECTED_REASONS.filter((t) => containsTrigger(text, t));
    return reasons.length > 0 ? [REJECTED_MARKER, ...reasons] : [];
  }
  const lower = text.toLowerCase();
  return ANY_OF_TRIGGERS[type].filter((t) =>
    t.caseInsensitive ? lower.includes(t.text.toLowerCase()) : text.includes(t.text),
  );
}

/** Trigger strings of `type` found in `text`; empty when the type does not match. */
export function matchedTriggers(text: string, type: SupportedIncidentType): string[] {
  return matchedTriggerSpecs(text, type).map((t) => t.text);
}

/** True when `text` matches the trigger rule of `type`. */
export function matchesIncidentType(text: string, type: SupportedIncidentType): boolean {
  return matchedTriggerSpecs(text, type).length > 0;
}

/** All matched Supported_Incident_Types, in PRIORITY order. */
export function detectIncidentTypes(text: string): SupportedIncidentType[] {
  return PRIORITY.filter((type) => matchesIncidentType(text, type));
}

/**
 * Trimmed lines of `text` that contain at least one matched trigger of `type`,
 * deduplicated in order of first appearance. Each entry is a substring of `text`.
 */
export function triggerLines(text: string, type: SupportedIncidentType): string[] {
  const triggers = matchedTriggerSpecs(text, type);
  if (triggers.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || seen.has(line)) continue;
    if (triggers.some((t) => containsTrigger(line, t))) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Terminal-output heuristic (Req 10.5)
// ---------------------------------------------------------------------------

/** Reflog line: `<hash> HEAD@{n}: <message>`. */
export const REFLOG_LINE = /^[0-9a-f]{7,40} HEAD@\{\d+\}: .*$/;

export const TERMINAL_LINE_PREFIXES: readonly string[] = [
  'error:',
  'hint:',
  'fatal:',
  '!',
  'To ',
  'CONFLICT',
  'On branch',
  'HEAD detached',
  'interactive rebase',
  'Auto-merging',
  'Automatic merge',
];

/** True when a single line (leading whitespace ignored) looks like Git terminal output. */
export function isTerminalOutputLine(line: string): boolean {
  const trimmed = line.replace(/^\s+/, '');
  if (TERMINAL_LINE_PREFIXES.some((p) => trimmed.startsWith(p))) return true;
  return REFLOG_LINE.test(trimmed.replace(/\s+$/, ''));
}

/** True when at least one line of `text` looks like Git terminal output. */
export function isTerminalOutput(text: string): boolean {
  return text.split(/\r?\n/).some(isTerminalOutputLine);
}
