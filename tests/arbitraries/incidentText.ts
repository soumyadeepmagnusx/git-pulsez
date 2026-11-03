/**
 * Incident_Text arbitraries for Fallback_Engine and input-validation properties.
 *
 * Noise lines come from {@link SAFE_WORDS}, so they never contain a trigger of
 * any Supported_Incident_Type and never look like Git terminal output. Each
 * trigger snippet contains triggers of its own type only, so the set of
 * detected types equals `includedTypes`.
 */

import fc from 'fast-check';
import { MAX_INCIDENT_CHARS, SUPPORTED_INCIDENT_TYPES, type SupportedIncidentType } from '../../src/shared/analysisContract';
import { PRIORITY } from '../../src/lib/fallback/patterns';
import { SAFE_WORDS, arbBranchName, arbCommitHash, arbPath } from './text';

export interface GeneratedIncidentText {
  text: string;
  /** Types whose trigger snippets were included, in PRIORITY order. */
  includedTypes: SupportedIncidentType[];
}

/** One noise line: lowercase safe words, optionally indented. */
export const arbNoiseLine: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom('', '  '), fc.array(fc.constantFrom(...SAFE_WORDS), { minLength: 1, maxLength: 8 }))
  .map(([indent, words]) => indent + words.join(' '));

/** Noise-only text (0..N lines) that matches no incident type. */
export function arbNoiseText(maxLines = 8): fc.Arbitrary<string> {
  return fc.array(arbNoiseLine, { minLength: 1, maxLength: maxLines }).map((lines) => lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Terminal-output trigger snippets (one or more lines per type)
// ---------------------------------------------------------------------------

/** `Merge conflict in <path>` line, used for entity extraction (P7). */
export function mergeConflictLine(path: string): string {
  return `CONFLICT (content): Merge conflict in ${path}`;
}

/** Reflog line `<hash> HEAD@{n}: <message>` (P7). */
export function reflogLine(hash: string, n: number, message: string): string {
  return `${hash} HEAD@{${n}}: ${message}`;
}

/** `interactive rebase in progress; onto <hash>` line (P7). */
export function rebaseOntoLine(hash: string): string {
  return `interactive rebase in progress; onto ${hash}`;
}

export const arbReflogLine: fc.Arbitrary<string> = fc
  .tuple(arbCommitHash, fc.integer({ min: 0, max: 50 }), fc.constantFrom('reset: moving to HEAD~2', 'checkout: moving from main to dev', 'commit: update docs'))
  .map(([h, n, m]) => reflogLine(h, n, m));

const SNIPPETS: Record<SupportedIncidentType, fc.Arbitrary<string>> = {
  rejected_push: fc
    .tuple(arbBranchName, fc.constantFrom('(fetch first)', '(non-fast-forward)'), fc.boolean())
    .map(([b, reason, hint]) =>
      [` ! [rejected]        ${b} -> ${b} ${reason}`, ...(hint ? ['hint: Updates were rejected because the tip of your current branch is behind'] : [])].join('\n'),
    ),
  merge_conflict: fc
    .tuple(fc.uniqueArray(arbPath, { minLength: 1, maxLength: 3 }), fc.boolean())
    .map(([paths, tail]) =>
      [...paths.map(mergeConflictLine), ...(tail ? ['Automatic merge failed; fix conflicts and then commit the result.'] : [])].join('\n'),
    ),
  detached_head: fc
    .tuple(arbCommitHash, fc.constantFrom('at', 'from'), fc.boolean())
    .map(([h, word, note]) => [`HEAD detached ${word} ${h.slice(0, 7)}`, ...(note ? ["You are in 'detached HEAD' state."] : [])].join('\n')),
  stuck_rebase: fc
    .tuple(arbCommitHash, arbCommitHash, fc.boolean())
    .map(([onto, applied, hint]) =>
      [
        `error: could not apply ${applied.slice(0, 7)}... update module`,
        ...(hint ? ['hint: then run "git rebase --continue".'] : []),
        rebaseOntoLine(onto),
      ].join('\n'),
    ),
  lost_commits: fc.oneof(
    fc.array(arbReflogLine, { minLength: 1, maxLength: 3 }).map((lines) => lines.join('\n')),
    fc.constantFrom('$ git reset --hard HEAD~3', 'git reset --hard origin/main'),
  ),
};

/** A terminal-output snippet containing triggers of `type` only. */
export function arbTriggerSnippet(type: SupportedIncidentType): fc.Arbitrary<string> {
  return SNIPPETS[type];
}

function sortByPriority(types: readonly SupportedIncidentType[]): SupportedIncidentType[] {
  return PRIORITY.filter((t) => types.includes(t));
}

/** Interleaves blocks (kept in order) with noise lines and joins with newlines. */
function arbInterleave(blocks: readonly string[]): fc.Arbitrary<string> {
  return fc
    .array(fc.array(arbNoiseLine, { maxLength: 2 }), { minLength: blocks.length + 1, maxLength: blocks.length + 1 })
    .map((noise) => {
      const lines: string[] = [];
      blocks.forEach((block, i) => {
        lines.push(...noise[i], block);
      });
      lines.push(...noise[blocks.length]);
      return lines.join('\n');
    });
}

export interface IncidentTextOptions {
  /** Restrict the types that may be included; defaults to all supported types. */
  types?: readonly SupportedIncidentType[];
  /** Minimum number of distinct types (default 0, so noise-only text is possible). */
  minTypes?: number;
  /** Maximum number of distinct types (default all). */
  maxTypes?: number;
}

/** Noise lines plus trigger snippets for a random subset of types, in random order. */
export function arbIncidentText(opts: IncidentTextOptions = {}): fc.Arbitrary<GeneratedIncidentText> {
  const pool = [...(opts.types ?? SUPPORTED_INCIDENT_TYPES)];
  const minTypes = opts.minTypes ?? 0;
  const maxTypes = opts.maxTypes ?? pool.length;
  return fc
    .shuffledSubarray(pool, { minLength: minTypes, maxLength: maxTypes })
    .chain((types) => (types.length === 0 ? fc.constant([] as string[]) : fc.tuple(...types.map(arbTriggerSnippet))).map((snips) => ({ types, snips })))
    .chain(({ types, snips }) =>
      arbInterleave(snips).map((text) => ({
        text: text.length > 0 ? text : SAFE_WORDS[0],
        includedTypes: sortByPriority(types),
      })),
    )
    .filter((g) => g.text.length <= MAX_INCIDENT_CHARS);
}

/** Text containing triggers of exactly one type (P2). */
export function arbSingleTypeIncidentText(type?: SupportedIncidentType): fc.Arbitrary<GeneratedIncidentText> {
  return (type ? fc.constant(type) : fc.constantFrom(...SUPPORTED_INCIDENT_TYPES)).chain((t) =>
    arbIncidentText({ types: [t], minTypes: 1, maxTypes: 1 }),
  );
}

// ---------------------------------------------------------------------------
// Plain-language text (no terminal-output lines; P8)
// ---------------------------------------------------------------------------

/**
 * Plain-language sentences mentioning triggers. Every line starts with `I `
 * or `My `, so no line matches the terminal-output heuristic.
 */
const PLAIN_SNIPPETS: Record<SupportedIncidentType, fc.Arbitrary<string>> = {
  rejected_push: arbBranchName.map((b) => `My push of ${b} shows [rejected] and says non-fast-forward.`),
  merge_conflict: arbPath.map((p) => `I see Automatic merge failed when merging ${p}.`),
  detached_head: fc.constant('I think I am in detached HEAD state.'),
  stuck_rebase: fc.constant('My terminal says rebase in progress and I do not know what to do.'),
  lost_commits: fc.constantFrom('I lost my commits yesterday.', 'My commits are gone after a mistake.', 'I want to undo a reset.'),
};

/** Plain-language text: noise sentences plus optional trigger sentences, no terminal-output line. */
export function arbPlainLanguageText(opts: IncidentTextOptions = {}): fc.Arbitrary<GeneratedIncidentText> {
  const pool = [...(opts.types ?? SUPPORTED_INCIDENT_TYPES)];
  return fc
    .shuffledSubarray(pool, { minLength: opts.minTypes ?? 0, maxLength: opts.maxTypes ?? pool.length })
    .chain((types) =>
      fc
        .tuple(
          types.length === 0 ? fc.constant([] as string[]) : fc.tuple(...types.map((t) => PLAIN_SNIPPETS[t])),
          fc.array(
            fc.array(fc.constantFrom(...SAFE_WORDS), { minLength: 1, maxLength: 6 }).map((w) => `I ${w.join(' ')}.`),
            { minLength: 1, maxLength: 4 },
          ),
        )
        .map(([snips, noise]) => ({ text: [...noise, ...snips].join('\n'), includedTypes: sortByPriority(types) })),
    );
}
