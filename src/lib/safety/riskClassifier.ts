/**
 * Risk classifier for Recovery_Step commands.
 *
 * Classifies each parsed Git invocation against the rule table in the design
 * ("Classification rules"). Matching uses whole option tokens and
 * case-sensitive short flags, so `--force-with-lease` never matches `--force`,
 * `-D` never matches `-d`, and `-n` never matches `-f` (Req 11.1).
 *
 * Requirements: 11.1, 11.13, 12.1, 12.4, 13.1, 13.8, 14.1, 14.2, 14.7, 14.8,
 * 15.1, 15.4, 15.6
 */

import type { RiskLevel } from '../../shared/analysisContract';
import { type GitInvocation, hasLongOpt, hasShortFlag, parseGitInvocations } from './gitCommandParser';
import type { CleanDetails, PushTarget, RiskyOperation } from './riskTypes';
import { BRANCH_PLACEHOLDER, DEFAULT_REMOTE } from './warnings';

export type { RiskyOperation } from './riskTypes';

export interface RiskyCommand {
  operation: RiskyOperation;
  level: RiskLevel;
  invocation: GitInvocation;
  /** Present for `clean_force`. */
  clean?: CleanDetails;
  /** Present for `push_force` and `push_force_with_lease`. */
  push?: PushTarget;
  /** Present for `branch_force_delete`. */
  branchNames?: string[];
}

/** Risk_Level defined for each Risky_Command operation (Req 12–15). */
export const OPERATION_LEVELS: Readonly<Record<RiskyOperation, RiskLevel>> = {
  reset_hard: 'destructive',
  checkout_force: 'destructive',
  clean_force: 'destructive',
  push_force: 'destructive',
  push_force_with_lease: 'caution',
  branch_force_delete: 'destructive',
};

function hasForce(inv: GitInvocation): boolean {
  return hasLongOpt(inv, '--force') || hasShortFlag(inv, 'f');
}

/** Extracts the clean `d`/`x`/`X` flags and pathspecs (positionals, including those after `--`). */
export function extractCleanDetails(inv: GitInvocation): CleanDetails {
  return {
    d: hasShortFlag(inv, 'd'),
    x: hasShortFlag(inv, 'x'),
    X: hasShortFlag(inv, 'X'),
    pathspecs: [...inv.positionals],
  };
}

/**
 * Extracts the push target (Req 14.7, 14.8). First positional is the remote;
 * the second is the refspec, whose destination (after `:`) is the branch,
 * with a leading `+` and a `refs/heads/` prefix removed.
 */
export function extractPushTarget(inv: GitInvocation): PushTarget {
  const [remoteWord, refspec] = inv.positionals;
  const remoteNamed = remoteWord !== undefined && remoteWord !== '';
  const remote = remoteNamed ? remoteWord : DEFAULT_REMOTE;

  let branch = '';
  if (refspec !== undefined) {
    let spec = refspec.startsWith('+') ? refspec.slice(1) : refspec;
    const colon = spec.indexOf(':');
    if (colon >= 0) {
      spec = spec.slice(colon + 1);
    }
    if (spec.startsWith('refs/heads/')) {
      spec = spec.slice('refs/heads/'.length);
    }
    branch = spec;
  }
  const branchNamed = branch !== '';
  return { remote, branch: branchNamed ? branch : BRANCH_PLACEHOLDER, remoteNamed, branchNamed };
}

/** Branch names from a force-delete invocation, or the `<branch>` placeholder (Req 15.4). */
export function extractBranchNames(inv: GitInvocation): string[] {
  const names = inv.positionals.filter((word) => word !== '');
  return names.length > 0 ? names : [BRANCH_PLACEHOLDER];
}

/** Classifies one parsed Git invocation; returns `null` when it is not a Risky_Command. */
export function classifyInvocation(inv: GitInvocation): RiskyCommand | null {
  const make = (operation: RiskyOperation, extra: Partial<RiskyCommand> = {}): RiskyCommand => ({
    operation,
    level: OPERATION_LEVELS[operation],
    invocation: inv,
    ...extra,
  });

  switch (inv.subcommand) {
    case 'reset':
      return hasLongOpt(inv, '--hard') ? make('reset_hard') : null;
    case 'checkout':
      return hasForce(inv) ? make('checkout_force') : null;
    case 'clean':
      // A force option makes the command destructive even when `-n` is also present.
      return hasForce(inv) ? make('clean_force', { clean: extractCleanDetails(inv) }) : null;
    case 'push':
      if (hasForce(inv)) {
        return make('push_force', { push: extractPushTarget(inv) });
      }
      if (hasLongOpt(inv, '--force-with-lease')) {
        return make('push_force_with_lease', { push: extractPushTarget(inv) });
      }
      return null;
    case 'branch': {
      const forceDelete =
        hasShortFlag(inv, 'D') ||
        ((hasShortFlag(inv, 'd') || hasLongOpt(inv, '--delete')) && hasForce(inv));
      return forceDelete ? make('branch_force_delete', { branchNames: extractBranchNames(inv) }) : null;
    }
    default:
      return null;
  }
}

/** Returns every Risky_Command in the command, in order of appearance across segments. */
export function classifyCommand(command: string): RiskyCommand[] {
  const risky: RiskyCommand[] = [];
  for (const inv of parseGitInvocations(command)) {
    const classified = classifyInvocation(inv);
    if (classified) {
      risky.push(classified);
    }
  }
  return risky;
}
