// Feature: gitpulse-recovery-assistant, Property 20: preserve_changes matcher accepts only untracked-inclusive stash push forms
/**
 * For any parsed Git invocation, the `preserve_changes` safeguard of
 * `reset_hard` and `checkout_force` is satisfied if and only if it is a
 * `git stash push` form (explicit or implied push) whose final untracked-files
 * state is enabled, with only allowed extra options and no pathspec or
 * partial-stash option. No `git commit` form satisfies it, nor does plain
 * `git stash` / `git stash push` without an untracked option. Consequently a
 * window of `git status` followed only by commit forms or non-untracked stash
 * forms gets `git stash push -u` inserted before the Risky_Step.
 *
 * **Validates: Requirements 12.6, 12.7, 12.13, 12.14, 12.15**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnalysisMode, AnalysisResult, RecoveryStep, RiskLevel } from '../../src/shared/analysisContract';
import { parseGitInvocations } from '../../src/lib/safety/gitCommandParser';
import { matchesPreserveChanges, preserveChangesSpec } from '../../src/lib/safety/safeguards';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAcceptedStashCommand, arbRejectedStashCommand, arbStashCommand } from '../arbitraries';

const arbRiskyCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('HEAD~1', 'HEAD', 'origin/main', 'abc1234').map((rev) => `git reset --hard ${rev}`),
  fc.constantFrom('main', 'feature', 'develop').map((b) => `git checkout -f ${b}`),
  fc.constantFrom('main', 'feature').map((b) => `git checkout --force ${b}`),
);

const arbMode = fc.constantFrom<AnalysisMode>('fallback_demo', 'bedrock_ai');
const arbRisk = fc.constantFrom<RiskLevel>('safe', 'caution', 'destructive');

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

const RUNS = { numRuns: 200 };

describe('Property 20: preserve_changes matcher accepts only untracked-inclusive stash push forms', () => {
  it('matcher result equals the reference model for any stash/commit form', () => {
    fc.assert(
      fc.property(arbStashCommand, (gen) => {
        const invs = parseGitInvocations(gen.command);
        expect(invs).toHaveLength(1);
        expect([invs[0].subcommand, ...invs[0].words]).toEqual(gen.words);
        expect(matchesPreserveChanges(invs[0])).toBe(gen.accepted);
        expect(preserveChangesSpec().matches(invs[0])).toBe(gen.accepted);
        if (gen.form === 'commit') expect(matchesPreserveChanges(invs[0])).toBe(false);
      }),
      RUNS,
    );
  });

  it('window `git status` + accepted stash form: nothing is inserted', () => {
    fc.assert(
      fc.property(arbAcceptedStashCommand, arbRiskyCommand, arbRisk, arbMode, (stash, risky, level, mode) => {
        const input = buildResult(['git status', stash.command], risky, level, mode);
        const output = validateSafety(input);
        expect(output.recoverySteps.map((s) => s.command)).toEqual(['git status', stash.command, risky]);
        expect(output.recoverySteps[2].riskLevel).toBe('destructive');
      }),
      RUNS,
    );
  });

  it('window `git status` + only rejected forms: exactly `git stash push -u` is inserted immediately before the risky step', () => {
    fc.assert(
      fc.property(
        fc.array(arbRejectedStashCommand, { minLength: 1, maxLength: 3 }),
        arbRiskyCommand,
        arbRisk,
        arbMode,
        (rejected, risky, level, mode) => {
          const windowCommands = ['git status', ...rejected.map((r) => r.command)];
          const output = validateSafety(buildResult(windowCommands, risky, level, mode));
          const commands = output.recoverySteps.map((s) => s.command);
          expect(commands).toEqual([...windowCommands, 'git stash push -u', risky]);
          const inserted = output.recoverySteps[commands.length - 2];
          expect(inserted.riskLevel).toBe('safe');
          expect(inserted.title).toBe(preserveChangesSpec().title);
          expect(output.recoverySteps.map((s) => s.stepNumber)).toEqual(commands.map((_, i) => i + 1));
        },
      ),
      RUNS,
    );
  });
});
