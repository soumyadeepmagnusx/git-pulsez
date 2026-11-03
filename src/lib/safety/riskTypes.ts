/**
 * Shared risk-classification types used by the warnings, safeguards, and
 * risk classifier modules. `riskClassifier.ts` (task 2.3) builds the full
 * `RiskyCommand` on top of these and should re-export `RiskyOperation`.
 */

export const RISKY_OPERATIONS = [
  'reset_hard',
  'checkout_force',
  'clean_force',
  'push_force',
  'push_force_with_lease',
  'branch_force_delete',
] as const;
export type RiskyOperation = (typeof RISKY_OPERATIONS)[number];

export interface CleanDetails {
  d: boolean;
  x: boolean;
  X: boolean;
  pathspecs: string[];
}

export interface PushTarget {
  remote: string;
  branch: string;
  remoteNamed: boolean;
  branchNamed: boolean;
}
