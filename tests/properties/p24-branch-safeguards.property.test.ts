// Feature: gitpulse-recovery-assistant, Property 24: Branch deletion safeguards use the branch name
/**
 * For any `git branch` Destructive_Command deleting branch `b`, the required
 * Safeguard_Set is `git log --oneline b` followed by `git branch --no-merged`;
 * any `git log` naming `b` satisfies the first and any `git branch --no-merged`
 * satisfies the second, while a `git log` that does not name `b` does not.
 *
 * **Validates: Requirements 15.4, 15.5**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnalysisMode, AnalysisResult, RecoveryStep, RiskLevel } from '../../src/shared/analysisContract';
import { parseGitInvocations } from '../../src/lib/safety/gitCommandParser';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { safeguardSetFor } from '../../src/lib/safety/safeguards';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbBranchForceDeleteCommand, arbBranchName, arbRenderWords, type GeneratedGitCommand } from '../arbitraries';

const RUNS = { numRuns: 200 };

const arbMode = fc.constantFrom<AnalysisMode>('fallback_demo', 'bedrock_ai');
const arbRisk = fc.constantFrom<RiskLevel>('safe', 'caution', 'destructive');

function namesOf(gen: GeneratedGitCommand): string[] {
  return gen.expected[0].branchNames!;
}

function step(n: number, command: string, riskLevel: RiskLevel): RecoveryStep {
  return { stepNumber: n, title: `Step ${n}`, explanation: `Run ${command}`, command, riskLevel };
}

function buildResult(windowCommands: string[], risky: string, riskyLevel: RiskLevel, mode: AnalysisMode): AnalysisResult {
  const commands = [...windowCommands, risky];
  return {
    incidentType: 'lost_commits',
    title: 'Test',
    confidence: 'medium',
    severity: 'high',
    analysisMode: mode,
    summary: 'Test result',
    detectedEvidence: [],
    assumptions: [],
    recoverySteps: commands.map((c, i) => step(i + 1, c, i === commands.length - 1 ? riskyLevel : 'safe')),
  };
}

/** A `git log` form naming `branch` as a revision, with random extra options and quoting. */
function arbLogNaming(branch: string): fc.Arbitrary<string> {
  return fc
    .tuple(fc.subarray(['--oneline', '--graph', '--decorate']), fc.boolean())
    .chain(([opts, before]) => arbRenderWords(['git', 'log', ...(before ? [...opts, branch] : [branch, ...opts])]));
}

/** `git branch --no-merged` with or without a value, with random quoting. */
const arbNoMerged: fc.Arbitrary<string> = fc
  .option(fc.oneof(fc.constant('HEAD'), arbBranchName), { nil: undefined })
  .chain((value) => arbRenderWords(['git', 'branch', value === undefined ? '--no-merged' : `--no-merged=${value}`]));

function canonicalSet(names: string[]): string[] {
  return [...names.map((b) => `git log --oneline ${b}`), 'git branch --no-merged'];
}

describe('Property 24: Branch deletion safeguards use the branch name', () => {
  it('required set is one `git log --oneline <b>` per branch, then `git branch --no-merged`; all inserted with no window', () => {
    fc.assert(
      fc.property(arbBranchForceDeleteCommand, arbRisk, arbMode, (gen, level, mode) => {
        expect(gen.expected).toHaveLength(1);
        const names = namesOf(gen);
        const risky = classifyCommand(gen.command);
        expect(risky).toHaveLength(1);
        expect(safeguardSetFor(risky[0]).map((s) => s.command)).toEqual(canonicalSet(names));

        const output = validateSafety(buildResult([], gen.command, level, mode));
        expect(output.recoverySteps.map((s) => s.command)).toEqual([...canonicalSet(names), gen.command]);
        output.recoverySteps.slice(0, -1).forEach((s) => expect(s.riskLevel).toBe('safe'));
        expect(output.recoverySteps.at(-1)!.riskLevel).toBe('destructive');
      }),
      RUNS,
    );
  });

  it('matchers: a log naming b matches; a log naming another branch does not; any --no-merged matches', () => {
    fc.assert(
      fc.property(
        arbBranchForceDeleteCommand.chain((gen) =>
          fc.nat({ max: namesOf(gen).length - 1 }).chain((idx) =>
            fc.record({
              gen: fc.constant(gen),
              idx: fc.constant(idx),
              ownLog: arbLogNaming(namesOf(gen)[idx]),
              otherLog: arbBranchName.filter((o) => !namesOf(gen).includes(o)).chain(arbLogNaming),
              noMerged: arbNoMerged,
            }),
          ),
        ),
        ({ gen, idx, ownLog, otherLog, noMerged }) => {
          const specs = safeguardSetFor(classifyCommand(gen.command)[0]);
          const logSpec = specs[idx];
          expect(logSpec.id).toBe('inspect_branch_log');
          const listSpec = specs[specs.length - 1];
          expect(listSpec.id).toBe('list_no_merged');

          const [ownInv] = parseGitInvocations(ownLog);
          const [otherInv] = parseGitInvocations(otherLog);
          const [noMergedInv] = parseGitInvocations(noMerged);

          expect(logSpec.matches(ownInv)).toBe(true);
          expect(logSpec.matches(otherInv)).toBe(false);
          expect(listSpec.matches(noMergedInv)).toBe(true);
          expect(listSpec.matches(ownInv)).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it('satisfying window (logs naming each branch, then any --no-merged): nothing inserted', () => {
    fc.assert(
      fc.property(
        arbBranchForceDeleteCommand.chain((gen) =>
          fc.record({
            gen: fc.constant(gen),
            logs: fc.tuple(...namesOf(gen).map(arbLogNaming)),
            noMerged: arbNoMerged,
          }),
        ),
        arbRisk,
        arbMode,
        ({ gen, logs, noMerged }, level, mode) => {
          const window = [...logs, noMerged];
          const output = validateSafety(buildResult(window, gen.command, level, mode));
          expect(output.recoverySteps.map((s) => s.command)).toEqual([...window, gen.command]);
        },
      ),
      RUNS,
    );
  });

  it('non-satisfying window (logs naming other branches, --no-merged): full set inserted before the risky step', () => {
    fc.assert(
      fc.property(
        arbBranchForceDeleteCommand.chain((gen) =>
          fc.record({
            gen: fc.constant(gen),
            logs: fc
              .array(arbBranchName.filter((o) => !namesOf(gen).includes(o)), { minLength: 1, maxLength: 2 })
              .chain((others) => fc.tuple(...others.map(arbLogNaming))),
            noMerged: arbNoMerged,
          }),
        ),
        arbRisk,
        arbMode,
        ({ gen, logs, noMerged }, level, mode) => {
          const window = [...logs, noMerged];
          const output = validateSafety(buildResult(window, gen.command, level, mode));
          expect(output.recoverySteps.map((s) => s.command)).toEqual([...window, ...canonicalSet(namesOf(gen)), gen.command]);
        },
      ),
      RUNS,
    );
  });
});
