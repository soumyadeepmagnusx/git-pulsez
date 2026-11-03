/**
 * Fixed command-specific warning texts (design: "Warning text constants").
 * Each text is a fixed sentence so tests can assert exact containment.
 * No text contains a Safety_Overclaim_Phrase, and only RESIDUAL_RISK_SENTENCE
 * contains RESIDUAL_RISK_LABEL (Req 11.6, 11.22).
 */

import { RESIDUAL_RISK_LABEL } from '../../shared/analysisContract';
import type { CleanDetails, PushTarget, RiskyOperation } from './riskTypes';

export type { RiskyOperation } from './riskTypes';

/** Req 12.2 */
export const RESET_UNCOMMITTED =
  'git reset --hard permanently discards all uncommitted changes in the working tree and the staging area.';
/** Req 12.3 */
export const BACKUP_BRANCH_LIMIT = 'A backup branch protects commits but does not protect uncommitted changes.';
/** Req 12.5 */
export const CHECKOUT_FORCE =
  'git checkout --force permanently discards local modifications to tracked files when the checkout proceeds.';
/** Req 12.9 */
export const STASH_NOT_GUARANTEE =
  'Running git status and git stash push -u first reduces risk but does not guarantee that this command is safe.';
/** Req 12.10 */
export const STASH_IGNORED =
  'git stash push -u does not save ignored files; only git stash push -a (--all) includes ignored files.';
/** Req 12.11 */
export const UNPROTECTED_DATA =
  'Data the safeguard steps do not capture remains at risk, including files outside the repository, unsaved editor buffers, and stash entries that can later be dropped or cleared.';
/** Req 13.2 */
export const CLEAN_PERMANENT =
  'git clean permanently deletes untracked files, and they cannot be recovered with git reflog or git stash.';
/** Req 13.3 */
export const CLEAN_X = 'The -x option also permanently deletes ignored files, such as .env files and build outputs.';
/** Req 13.4 */
export const CLEAN_BIG_X = 'The -X option permanently deletes ignored files.';
/** Req 14.3 */
export const PUSH_FORCE_OVERWRITE =
  'A force push overwrites the remote branch history and removes commits that teammates pushed and that your local branch lacks.';
/** Req 14.4 */
export const PUSH_FORCE_LEASE_ADVICE =
  'Use git push --force-with-lease instead, and only for a personal branch after a rebase; rewriting a shared branch such as main requires coordination with teammates first.';
/** Req 14.5 */
export const LEASE_LIMITS =
  'git push --force-with-lease still rewrites remote history. The lease protects only against remote commits that have not been fetched yet, and a fetch without inspection makes the lease check pass for commits you have not reviewed.';
/** Req 14.11 template; substitute `<remote>` and `<branch>` with {@link leaseConditions}. */
export const LEASE_CONDITIONS =
  'Consider this push only after inspecting the remote changes with git fetch <remote> and git log --oneline HEAD..<remote>/<branch>, confirming that <branch> is the intended target branch, and confirming that your team workflow permits rewriting the branch (the branch is personal or teammates agreed to the rewrite).';
/** Req 15.2 */
export const BRANCH_REFLOG_LIMIT =
  'Unmerged commits on the deleted branch stop being reachable from any branch and stay recoverable through git reflog only for a limited time before Git garbage collection removes them.';
/** Req 15.3 template; substitute `<branch>` with {@link branchTagBackup}. */
export const BRANCH_TAG_BACKUP = 'Optional backup before deleting: git tag backup/<branch> <branch>.';
/** Req 11.7 */
export const GENERIC_DESTRUCTIVE_WARNING =
  'This command can discard work or rewrite history. Inspect the repository state with git status and git log before running it.';
/** Req 11.6: the only text containing RESIDUAL_RISK_LABEL. */
export const RESIDUAL_RISK_SENTENCE = `${RESIDUAL_RISK_LABEL}.`;

export const DEFAULT_REMOTE = 'origin';
export const BRANCH_PLACEHOLDER = '<branch>';

/** Every fixed constant/template, for overclaim and label checks in tests. */
export const ALL_WARNING_TEXTS: readonly string[] = [
  RESET_UNCOMMITTED,
  BACKUP_BRANCH_LIMIT,
  CHECKOUT_FORCE,
  STASH_NOT_GUARANTEE,
  STASH_IGNORED,
  UNPROTECTED_DATA,
  CLEAN_PERMANENT,
  CLEAN_X,
  CLEAN_BIG_X,
  PUSH_FORCE_OVERWRITE,
  PUSH_FORCE_LEASE_ADVICE,
  LEASE_LIMITS,
  LEASE_CONDITIONS,
  BRANCH_REFLOG_LIMIT,
  BRANCH_TAG_BACKUP,
  GENERIC_DESTRUCTIVE_WARNING,
  RESIDUAL_RISK_SENTENCE,
];

/** Single-pass placeholder substitution, so substituted values are never re-scanned. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/<remote>|<branch>/g, (token) => values[token] ?? token);
}

export function leaseConditions(remote: string, branch: string): string {
  return fill(LEASE_CONDITIONS, { '<remote>': remote, '<branch>': branch });
}

export function branchTagBackup(branch: string): string {
  return fill(BRANCH_TAG_BACKUP, { '<branch>': branch });
}

/**
 * Structural subset of `RiskyCommand` (task 2.3) needed to build warnings.
 * The full `RiskyCommand` is assignable to this type.
 */
export interface WarningInput {
  operation: RiskyOperation;
  clean?: CleanDetails;
  push?: PushTarget;
  branchNames?: string[];
}

/** Command-specific warning texts for one Risky_Command, in a fixed order per operation. */
export function warningTextsFor(risky: WarningInput): string[] {
  switch (risky.operation) {
    case 'reset_hard':
      return [RESET_UNCOMMITTED, BACKUP_BRANCH_LIMIT, STASH_NOT_GUARANTEE, STASH_IGNORED, UNPROTECTED_DATA];
    case 'checkout_force':
      return [CHECKOUT_FORCE, STASH_NOT_GUARANTEE, STASH_IGNORED, UNPROTECTED_DATA];
    case 'clean_force': {
      const texts = [CLEAN_PERMANENT];
      if (risky.clean?.x) texts.push(CLEAN_X);
      if (risky.clean?.X) texts.push(CLEAN_BIG_X);
      return texts;
    }
    case 'push_force':
      return [PUSH_FORCE_OVERWRITE, PUSH_FORCE_LEASE_ADVICE];
    case 'push_force_with_lease': {
      const remote = risky.push?.remote ?? DEFAULT_REMOTE;
      const branch = risky.push?.branch ?? BRANCH_PLACEHOLDER;
      return [LEASE_LIMITS, leaseConditions(remote, branch)];
    }
    case 'branch_force_delete': {
      const names = risky.branchNames && risky.branchNames.length > 0 ? risky.branchNames : [BRANCH_PLACEHOLDER];
      return [BRANCH_REFLOG_LIMIT, ...names.map(branchTagBackup)];
    }
  }
}
