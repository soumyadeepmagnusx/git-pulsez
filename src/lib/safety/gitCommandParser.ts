/**
 * Git command parser for Recovery_Step commands.
 *
 * Turns shell words (from `shellTokenizer.ts`) into `GitInvocation` records:
 * the subcommand plus its parsed long options, expanded short flags,
 * positionals, and the words after `--`.
 *
 * Parsing rules:
 * - A segment is a Git invocation when its first word is `git` (after any
 *   leading `NAME=value` environment assignments). A path to the binary such
 *   as `/usr/bin/git` or `git.exe` also counts.
 * - Global options before the subcommand are skipped. `-C`, `-c`,
 *   `--git-dir`, `--work-tree`, `--namespace`, `--config-env`, and
 *   `--super-prefix` consume the next word unless written as `--name=value`.
 * - `--name=value` is stored in `longOpts` as `--name` with `value`; other
 *   long options are stored with `true`. Long options are compared as whole
 *   tokens, so `--force-with-lease` never equals `--force`.
 * - A short group such as `-fdx` expands to `f`, `d`, `x`. Flags are
 *   case-sensitive, so `D` and `d` stay distinct.
 * - Per-subcommand value-taking short options (for example `m` for `stash`
 *   and `commit`) consume the rest of their group, or the next word when the
 *   group ends. The value is never parsed as an option or positional, so
 *   `git commit -m "--force"` yields no `--force` option.
 * - `--` ends option parsing. Later words go to `afterDoubleDash` and are
 *   also included in `positionals`.
 *
 * Requirements: 11.1
 */

import { tokenizeCommand } from './shellTokenizer';

export interface GitInvocation {
  /** The Git subcommand, for example `reset` or `stash`. */
  subcommand: string;
  /** The raw words after the subcommand, in original order. */
  words: string[];
  /** Long options; `--name=value` maps to `value`, others map to `true`. The last occurrence wins. */
  longOpts: Map<string, string | true>;
  /** Expanded short flags in order of appearance (duplicates kept). */
  shortFlags: string[];
  /** Non-option words, including the words after `--`. */
  positionals: string[];
  /** Words after the first `--`. */
  afterDoubleDash: string[];
}

/** Short options that take a value, per subcommand. */
export const VALUE_SHORT_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  stash: new Set(['m']),
  commit: new Set(['m', 'F', 'C', 'c']),
  clean: new Set(['e']),
  push: new Set(['o']),
  checkout: new Set(['b', 'B']),
};

/**
 * Long options that take a required value, per subcommand. Git accepts these
 * values as the next word, so the next word must not be read as an option or
 * positional. Long options with optional values (such as
 * `--force-with-lease`) accept a value only through `=` and are not listed.
 */
export const VALUE_LONG_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  stash: new Set(['--message', '--pathspec-from-file']),
  commit: new Set([
    '--message',
    '--file',
    '--reuse-message',
    '--reedit-message',
    '--fixup',
    '--squash',
    '--author',
    '--date',
    '--cleanup',
    '--pathspec-from-file',
  ]),
  clean: new Set(['--exclude']),
  push: new Set(['--push-option', '--repo', '--receive-pack', '--exec']),
  checkout: new Set(['--orphan', '--pathspec-from-file']),
};

/** Global options that take the next word as their value. */
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix',
]);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isGitExecutable(word: string): boolean {
  const base = word.split(/[\\/]/).pop() ?? word;
  return base === 'git' || base.toLowerCase() === 'git.exe';
}

/**
 * Parses one segment of shell words. Returns `null` when the segment is not
 * a Git invocation or has no subcommand.
 */
export function parseGitSegment(segmentWords: readonly string[]): GitInvocation | null {
  let i = 0;
  while (i < segmentWords.length && ENV_ASSIGNMENT.test(segmentWords[i])) {
    i += 1;
  }
  if (i >= segmentWords.length || !isGitExecutable(segmentWords[i])) {
    return null;
  }
  i += 1;

  // Skip global options.
  while (i < segmentWords.length) {
    const word = segmentWords[i];
    if (!word.startsWith('-') || word === '-') {
      break;
    }
    if (word === '--') {
      // `git -- <cmd>` is unusual; treat the next word as the subcommand.
      i += 1;
      break;
    }
    i += GLOBAL_OPTIONS_WITH_VALUE.has(word) ? 2 : 1;
  }
  if (i >= segmentWords.length) {
    return null;
  }

  const subcommand = segmentWords[i];
  const words = segmentWords.slice(i + 1);
  const valueShorts = VALUE_SHORT_OPTIONS[subcommand] ?? new Set<string>();
  const valueLongs = VALUE_LONG_OPTIONS[subcommand] ?? new Set<string>();

  const longOpts = new Map<string, string | true>();
  const shortFlags: string[] = [];
  const positionals: string[] = [];
  const afterDoubleDash: string[] = [];

  let j = 0;
  while (j < words.length) {
    const word = words[j];

    if (word === '--') {
      const rest = words.slice(j + 1);
      afterDoubleDash.push(...rest);
      positionals.push(...rest);
      break;
    }

    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      if (eq >= 0) {
        longOpts.set(word.slice(0, eq), word.slice(eq + 1));
        j += 1;
      } else if (valueLongs.has(word) && j + 1 < words.length) {
        longOpts.set(word, words[j + 1]);
        j += 2;
      } else {
        longOpts.set(word, true);
        j += 1;
      }
      continue;
    }

    if (word.startsWith('-') && word.length > 1) {
      let consumedNext = false;
      for (let k = 1; k < word.length; k += 1) {
        const flag = word[k];
        shortFlags.push(flag);
        if (valueShorts.has(flag)) {
          // The value is the rest of the group, or the next word.
          if (k === word.length - 1 && j + 1 < words.length) {
            consumedNext = true;
          }
          break;
        }
      }
      j += consumedNext ? 2 : 1;
      continue;
    }

    positionals.push(word);
    j += 1;
  }

  return { subcommand, words, longOpts, shortFlags, positionals, afterDoubleDash };
}

/** Parses every Git invocation in a command, in order of appearance. */
export function parseGitInvocations(command: string): GitInvocation[] {
  const invocations: GitInvocation[] = [];
  for (const segment of tokenizeCommand(command)) {
    const invocation = parseGitSegment(segment);
    if (invocation) {
      invocations.push(invocation);
    }
  }
  return invocations;
}

/** True when the invocation has the long option (with or without a value). */
export function hasLongOpt(inv: GitInvocation, name: string): boolean {
  return inv.longOpts.has(name);
}

/** True when the invocation has the short flag (case-sensitive). */
export function hasShortFlag(inv: GitInvocation, flag: string): boolean {
  return inv.shortFlags.includes(flag);
}
