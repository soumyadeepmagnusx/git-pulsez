/**
 * Safeguard sets and matchers (design: "Safeguard Sets and Matchers").
 *
 * Each Risky_Command requires an ordered Safeguard_Set. Every safeguard has a
 * canonical command (used when the Safety_Validator inserts it and in
 * `backupPrerequisite`) and a matcher (used when checking the
 * Safeguard_Window). A window step satisfies a safeguard when any Git
 * invocation in the step's command satisfies the matcher.
 *
 * Every inserted-step explanation ends with {@link SAFEGUARD_RISK_NOTE} and
 * contains no Safety_Overclaim_Phrase (Req 11.10, 11.22).
 *
 * Requirements: 11.8, 11.9, 11.10, 12.6, 12.7, 12.8, 12.12, 12.13, 12.14,
 * 12.15, 13.5, 13.6, 13.7, 14.6, 14.7, 14.8, 14.9, 14.10, 15.4, 15.5
 */

import { type GitInvocation, hasLongOpt, hasShortFlag, parseGitInvocations } from './gitCommandParser';
import type { RiskyCommand } from './riskClassifier';
import type { CleanDetails, PushTarget } from './riskTypes';
import { BRANCH_PLACEHOLDER, DEFAULT_REMOTE } from './warnings';

export type SafeguardId =
  | 'inspect_status'
  | 'preserve_changes'
  | 'clean_dry_run'
  | 'fetch_remote'
  | 'inspect_remote_log'
  | 'inspect_branch_log'
  | 'list_no_merged';

export interface SafeguardSpec {
  id: SafeguardId;
  /** Canonical command inserted by the Safety_Validator. */
  command: string;
  title: string;
  explanation: string;
  /** True when the parsed invocation satisfies this safeguard. */
  matches(inv: GitInvocation): boolean;
}

/** Closing sentence of every inserted-step explanation (Req 11.10). */
export const SAFEGUARD_RISK_NOTE = 'This step reduces risk but does not make the next step safe.';

/** Statement required for reset/checkout safeguards (Req 12.12). */
export const SAFEGUARD_SCOPE_NOTE = 'This step does not protect ignored files or data outside the repository.';

// ---------------------------------------------------------------------------
// Shell quoting for canonical commands
// ---------------------------------------------------------------------------

const PLAIN_WORD = /^[A-Za-z0-9_\-./:@+=,%^~<>]+$/;

/** Quotes a word so that `tokenizeCommand` reads it back unchanged. */
export function quoteShellWord(word: string): string {
  if (word !== '' && PLAIN_WORD.test(word)) {
    return word;
  }
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

function hasForce(inv: GitInvocation): boolean {
  return hasLongOpt(inv, '--force') || hasShortFlag(inv, 'f');
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}

/** Positionals before `--` (revisions rather than paths). */
function revisionPositionals(inv: GitInvocation): string[] {
  const count = inv.positionals.length - inv.afterDoubleDash.length;
  return inv.positionals.slice(0, Math.max(0, count));
}

export function matchesInspectStatus(inv: GitInvocation): boolean {
  return inv.subcommand === 'status';
}

/**
 * `preserve_changes` matcher (Req 12.7, 12.13–12.15). Walks the raw words
 * left to right so that the last untracked-files option wins and `-m`
 * consumes its value.
 */
export function matchesPreserveChanges(inv: GitInvocation): boolean {
  if (inv.subcommand !== 'stash') return false;
  const rest = inv.words;
  if (rest.length === 0) return false; // plain `git stash`

  let args: readonly string[];
  if (rest[0] === 'push') {
    args = rest.slice(1);
  } else if (rest[0].startsWith('-')) {
    args = rest; // implied push
  } else {
    return false; // save, pop, list, apply, drop, clear, other
  }

  let includeUntracked = false;
  let i = 0;
  while (i < args.length) {
    const word = args[i];

    if (word.startsWith('--')) {
      if (word === '--') return false; // pathspec separator
      if (word.startsWith('--message=')) {
        i += 1;
        continue;
      }
      switch (word) {
        case '--include-untracked':
        case '--all':
          includeUntracked = true;
          break;
        case '--no-include-untracked':
        case '--no-all':
          includeUntracked = false;
          break;
        case '--keep-index':
        case '--no-keep-index':
        case '--quiet':
          break;
        case '--message':
          if (i + 1 >= args.length) return false; // missing value
          i += 1; // consume the message
          break;
        default:
          return false; // any other long option
      }
      i += 1;
      continue;
    }

    if (word.startsWith('-') && word.length > 1) {
      let consumeNext = false;
      for (let k = 1; k < word.length; k += 1) {
        const flag = word[k];
        if (flag === 'u' || flag === 'a') {
          includeUntracked = true;
        } else if (flag === 'k' || flag === 'q') {
          // allowed
        } else if (flag === 'm') {
          if (k === word.length - 1) {
            if (i + 1 >= args.length) return false; // missing value
            consumeNext = true;
          }
          break; // the rest of the group is the message
        } else {
          return false; // -p, -S, or any other short option
        }
      }
      i += consumeNext ? 2 : 1;
      continue;
    }

    return false; // pathspec positional or lone `-`
  }

  return includeUntracked;
}

/** `clean_dry_run` matcher (Req 13.6). */
export function makeCleanDryRunMatcher(clean: CleanDetails): (inv: GitInvocation) => boolean {
  return (inv) => {
    if (inv.subcommand !== 'clean') return false;
    if (!(hasShortFlag(inv, 'n') || hasLongOpt(inv, '--dry-run'))) return false;
    if (hasForce(inv)) return false;
    if (hasShortFlag(inv, 'd') !== clean.d) return false;
    if (hasShortFlag(inv, 'x') !== clean.x) return false;
    if (hasShortFlag(inv, 'X') !== clean.X) return false;
    return sameSet(inv.positionals, clean.pathspecs);
  };
}

export function matchesFetchRemote(inv: GitInvocation): boolean {
  return inv.subcommand === 'fetch';
}

/** `inspect_remote_log` matcher (Req 14.9). */
export function makeRemoteLogMatcher(push: PushTarget): (inv: GitInvocation) => boolean {
  const exact = `HEAD..${push.remote}/${push.branch}`;
  const prefix = `HEAD..${push.remote}/`;
  return (inv) => {
    if (inv.subcommand !== 'log') return false;
    return revisionPositionals(inv).some((word) =>
      push.branchNamed ? word === exact : word.startsWith(prefix) && word.length > prefix.length,
    );
  };
}

/** `inspect_branch_log` matcher (Req 15.5). */
export function makeBranchLogMatcher(branch: string): (inv: GitInvocation) => boolean {
  return (inv) => inv.subcommand === 'log' && revisionPositionals(inv).includes(branch);
}

export function matchesListNoMerged(inv: GitInvocation): boolean {
  return inv.subcommand === 'branch' && hasLongOpt(inv, '--no-merged');
}

// ---------------------------------------------------------------------------
// Canonical commands and templates
// ---------------------------------------------------------------------------

/** Canonical dry run: `git clean -n` + `d`, `x`, `X` in that order + pathspecs after `--` (Req 13.5). */
export function cleanDryRunCommand(clean: CleanDetails): string {
  const flags = `-n${clean.d ? 'd' : ''}${clean.x ? 'x' : ''}${clean.X ? 'X' : ''}`;
  const paths = clean.pathspecs.length > 0 ? ` -- ${clean.pathspecs.map(quoteShellWord).join(' ')}` : '';
  return `git clean ${flags}${paths}`;
}

export function inspectStatusSpec(): SafeguardSpec {
  return {
    id: 'inspect_status',
    command: 'git status',
    title: 'Inspect the working tree',
    explanation:
      'git status lists the modified, staged, and untracked files that the next command would affect, so you can see what is at risk before you continue. ' +
      `${SAFEGUARD_SCOPE_NOTE} ${SAFEGUARD_RISK_NOTE}`,
    matches: matchesInspectStatus,
  };
}

export function preserveChangesSpec(): SafeguardSpec {
  return {
    id: 'preserve_changes',
    command: 'git stash push -u',
    title: 'Save uncommitted and untracked changes',
    explanation:
      'git stash push -u saves tracked, staged, and untracked non-ignored changes. Ignored files are not saved. ' +
      'Run git stash pop afterwards to restore the saved changes. ' +
      `${SAFEGUARD_SCOPE_NOTE} ${SAFEGUARD_RISK_NOTE}`,
    matches: matchesPreserveChanges,
  };
}

export function cleanDryRunSpec(clean: CleanDetails): SafeguardSpec {
  const command = cleanDryRunCommand(clean);
  return {
    id: 'clean_dry_run',
    command,
    title: 'Preview which files would be deleted',
    explanation:
      `The dry run (${command}) lists the files that the cleanup command would delete and deletes no files. ` +
      `Review the list and move anything you want to keep. ${SAFEGUARD_RISK_NOTE}`,
    matches: makeCleanDryRunMatcher(clean),
  };
}

export function fetchRemoteSpec(push: PushTarget): SafeguardSpec {
  const remote = push.remote || DEFAULT_REMOTE;
  return {
    id: 'fetch_remote',
    command: `git fetch ${quoteShellWord(remote)}`,
    title: 'Fetch the latest remote state',
    explanation:
      `Downloads commits from ${remote} without changing your local branches, so you can inspect them in the next step. ` +
      SAFEGUARD_RISK_NOTE,
    matches: matchesFetchRemote,
  };
}

export function inspectRemoteLogSpec(push: PushTarget): SafeguardSpec {
  const remote = push.remote || DEFAULT_REMOTE;
  const branch = push.branch || BRANCH_PLACEHOLDER;
  return {
    id: 'inspect_remote_log',
    command: `git log --oneline ${quoteShellWord(`HEAD..${remote}/${branch}`)}`,
    title: 'Inspect commits that exist only on the remote',
    explanation:
      `Lists the commits on ${remote}/${branch} that your local branch does not have. ` +
      'Each listed commit exists only on the remote and will be removed from the remote branch by the force push. ' +
      SAFEGUARD_RISK_NOTE,
    matches: makeRemoteLogMatcher({ ...push, remote, branch }),
  };
}

export function inspectBranchLogSpec(branch: string): SafeguardSpec {
  return {
    id: 'inspect_branch_log',
    command: `git log --oneline ${quoteShellWord(branch)}`,
    title: `Review commits on ${branch}`,
    explanation: `Shows the commits on ${branch} that deletion could make unreachable. ${SAFEGUARD_RISK_NOTE}`,
    matches: makeBranchLogMatcher(branch),
  };
}

export function listNoMergedSpec(branches: readonly string[]): SafeguardSpec {
  const names = branches.length > 0 ? branches.join(' or ') : BRANCH_PLACEHOLDER;
  return {
    id: 'list_no_merged',
    command: 'git branch --no-merged',
    title: 'List branches with unmerged commits',
    explanation:
      `Shows branches whose commits are not merged into the current branch. If ${names} appears, deleting it loses those commits from every branch. ` +
      SAFEGUARD_RISK_NOTE,
    matches: matchesListNoMerged,
  };
}

/** Ordered Safeguard_Set required for one Risky_Command (Req 12.6, 13.5, 14.6–14.8, 15.4). */
export function safeguardSetFor(risky: RiskyCommand): SafeguardSpec[] {
  switch (risky.operation) {
    case 'reset_hard':
    case 'checkout_force':
      return [inspectStatusSpec(), preserveChangesSpec()];
    case 'clean_force':
      return [cleanDryRunSpec(risky.clean ?? { d: false, x: false, X: false, pathspecs: [] })];
    case 'push_force':
    case 'push_force_with_lease': {
      const push: PushTarget = risky.push ?? {
        remote: DEFAULT_REMOTE,
        branch: BRANCH_PLACEHOLDER,
        remoteNamed: false,
        branchNamed: false,
      };
      return [fetchRemoteSpec(push), inspectRemoteLogSpec(push)];
    }
    case 'branch_force_delete': {
      const names = risky.branchNames && risky.branchNames.length > 0 ? risky.branchNames : [BRANCH_PLACEHOLDER];
      return [...names.map(inspectBranchLogSpec), listNoMergedSpec(names)];
    }
  }
}

/** True when any Git invocation in the step command satisfies the safeguard. */
export function windowSatisfies(stepCommand: string, spec: SafeguardSpec): boolean {
  return parseGitInvocations(stepCommand).some((inv) => spec.matches(inv));
}
