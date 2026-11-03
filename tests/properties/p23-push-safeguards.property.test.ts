// Feature: gitpulse-recovery-assistant, Property 23: Push safeguards use the push target
/**
 * For any `git push` Risky_Command with an optional remote and optional
 * refspec, the inserted Safeguard_Steps are `git fetch <remote>` and
 * `git log --oneline HEAD..<remote>/<branch>`, using the named remote and
 * branch when present and `origin` and `<branch>` when omitted; any `git fetch`
 * command satisfies the fetch safeguard, and a `git log` command satisfies the
 * inspection safeguard if and only if it contains the matching
 * `HEAD..<remote>/<branch>` range.
 *
 * **Validates: Requirements 14.6, 14.7, 14.8, 14.9**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult, RecoveryStep } from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import type { PushTarget } from '../../src/lib/safety/riskTypes';
import { arbBranchName, arbPushForceCommand, arbRemoteName, arbSimpleName } from '../arbitraries';

function step(command: string): RecoveryStep {
  return { stepNumber: 1, title: 'Step', explanation: 'Explanation.', command, riskLevel: 'safe' };
}

function resultWith(commands: readonly string[]): AnalysisResult {
  return {
    incidentType: 'rejected_push',
    title: 'Push',
    confidence: 'medium',
    severity: 'medium',
    analysisMode: 'fallback_demo',
    summary: 'Summary.',
    detectedEvidence: [],
    assumptions: [],
    recoverySteps: commands.map((c, i) => ({ ...step(c), stepNumber: i + 1 })),
  };
}

function outputCommands(commands: readonly string[]): string[] {
  return validateSafety(resultWith(commands)).recoverySteps.map((s) => s.command);
}

/** Any `git fetch` form: no remote, the push remote, another remote, or `--all`. */
const arbAnyFetch: fc.Arbitrary<string> = fc.oneof(
  fc.constant('git fetch'),
  fc.constant('git fetch --all'),
  fc.constant('git fetch --prune'),
  arbRemoteName.map((r) => `git fetch ${r}`),
);

/** A `git log` that satisfies the remote-log safeguard for `push`. */
function arbSatisfyingLog(push: PushTarget): fc.Arbitrary<string> {
  const branch = push.branchNamed ? fc.constant(push.branch) : arbBranchName;
  return fc
    .tuple(branch, fc.constantFrom('git log --oneline', 'git log', 'git log --oneline -n 5', 'git --no-pager log --graph'))
    .map(([b, prefix]) => `${prefix} HEAD..${push.remote}/${b}`);
}

/** A `git log` naming a different remote or (when the branch is named) a different branch. */
function arbNonSatisfyingLog(push: PushTarget): fc.Arbitrary<string> {
  const otherRemote = fc
    .tuple(arbRemoteName.filter((r) => r !== push.remote), push.branchNamed ? fc.constant(push.branch) : arbBranchName)
    .map(([r, b]) => `git log --oneline HEAD..${r}/${b}`);
  if (!push.branchNamed) return otherRemote;
  const otherBranch = arbBranchName
    .filter((b) => b !== push.branch)
    .map((b) => `git log --oneline HEAD..${push.remote}/${b}`);
  return fc.oneof(otherRemote, otherBranch);
}

describe('Property 23: Push safeguards use the push target', () => {
  it('inserts git fetch <remote> and git log --oneline HEAD..<remote>/<branch> from the push target', () => {
    fc.assert(
      fc.property(arbPushForceCommand, (cmd) => {
        const push = cmd.expected[0].push!;
        const remote = push.remoteNamed ? push.remote : 'origin';
        const branch = push.branchNamed ? push.branch : '<branch>';
        expect(push.remote).toBe(remote);
        expect(push.branch).toBe(branch);
        expect(outputCommands([cmd.command])).toEqual([
          `git fetch ${remote}`,
          `git log --oneline HEAD..${remote}/${branch}`,
          cmd.command,
        ]);
      }),
      { numRuns: 200 },
    );
  });

  it('accepts any git fetch and a matching HEAD..<remote>/<branch> log as satisfying the window', () => {
    fc.assert(
      fc.property(
        arbPushForceCommand.chain((cmd) =>
          fc.tuple(fc.constant(cmd), arbAnyFetch, arbSatisfyingLog(cmd.expected[0].push!)),
        ),
        ([cmd, fetch, log]) => {
          expect(outputCommands([fetch, log, cmd.command])).toEqual([fetch, log, cmd.command]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a git log naming a different remote or branch and inserts only the inspection step', () => {
    fc.assert(
      fc.property(
        arbPushForceCommand.chain((cmd) =>
          fc.tuple(
            fc.constant(cmd),
            arbAnyFetch,
            arbNonSatisfyingLog(cmd.expected[0].push!),
            fc.option(arbSimpleName.map((n) => `echo ${n}`), { nil: undefined }),
          ),
        ),
        ([cmd, fetch, log, noise]) => {
          const { remote, branch } = cmd.expected[0].push!;
          const window = noise ? [fetch, noise, log] : [fetch, log];
          expect(outputCommands([...window, cmd.command])).toEqual([
            ...window,
            `git log --oneline HEAD..${remote}/${branch}`,
            cmd.command,
          ]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
