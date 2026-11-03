// Feature: gitpulse-recovery-assistant, Property 25: Unclassified destructive steps get a warning
/**
 * For any Recovery_Step with `riskLevel` `destructive`, no Risky_Command, and
 * an empty or missing `warningMessage`, the output `warningMessage` is
 * non-empty and equals GENERIC_DESTRUCTIVE_WARNING; with a non-empty input
 * warning, the warning is unchanged. Unclassified `safe` / `caution` steps keep
 * their warning state (no warning is added), and no Safeguard_Steps are
 * inserted for unclassified steps.
 *
 * **Validates: Requirements 11.7**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult, RecoveryStep, RiskLevel } from '../../src/shared/analysisContract';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { GENERIC_DESTRUCTIVE_WARNING } from '../../src/lib/safety/warnings';
import {
  arbBranchName,
  arbCommitHash,
  arbDistractorCommand,
  arbNonRiskyGitCommand,
  arbPath,
  arbSafeText,
  arbWarningText,
} from '../arbitraries';

/** Commands that can destroy work or rewrite history but are not Risky_Commands in the classifier's rule table. */
const arbUnclassifiedDestructiveCommand: fc.Arbitrary<string> = fc.oneof(
  arbPath.map((p) => `rm -rf ${p}`),
  fc.integer({ min: 1, max: 9 }).map((n) => `git rebase -i HEAD~${n}`),
  arbPath.map((p) => `git filter-branch --tree-filter 'rm -f ${p}' HEAD`),
  arbPath.map((p) => `git filter-branch --index-filter "git rm --cached --ignore-unmatch ${p}" -- --all`),
  fc.constant('git reflog expire --expire=now --all'),
  fc.constant('git gc --prune=now --aggressive'),
  fc.integer({ min: 0, max: 5 }).map((n) => `git stash drop stash@{${n}}`),
  fc.constant('git stash clear'),
  arbBranchName.map((b) => `git update-ref -d refs/heads/${b}`),
  arbCommitHash.map((h) => `git reset --keep ${h}`),
  fc.constant('git restore .'),
  fc.constant('git checkout -- .'),
  arbBranchName.map((b) => `git push origin --delete ${b}`),
  arbCommitHash.map((h) => `git rebase --onto ${h} HEAD~2 && rm -rf .git/rebase-merge`),
);

const arbUnclassifiedCommand: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: arbUnclassifiedDestructiveCommand },
  { weight: 1, arbitrary: arbNonRiskyGitCommand.map((c) => c.command) },
  { weight: 1, arbitrary: arbDistractorCommand },
);

type WarningInput = { kind: 'missing' } | { kind: 'empty' } | { kind: 'text'; text: string };

const arbWarningInput: fc.Arbitrary<WarningInput> = fc.oneof(
  fc.constant<WarningInput>({ kind: 'missing' }),
  fc.constant<WarningInput>({ kind: 'empty' }),
  arbWarningText({ allowLabel: true }).map((text): WarningInput => ({ kind: 'text', text })),
);

const arbUnclassifiedStep: fc.Arbitrary<RecoveryStep> = fc
  .record({
    command: arbUnclassifiedCommand,
    riskLevel: fc.constantFrom<RiskLevel>('safe', 'caution', 'destructive', 'destructive'),
    title: arbSafeText({ maxWords: 4 }),
    explanation: arbSafeText(),
    warning: arbWarningInput,
    backup: fc.option(arbSafeText({ maxWords: 4 }), { nil: undefined }),
  })
  .map(({ command, riskLevel, title, explanation, warning, backup }) => {
    const step: RecoveryStep = { stepNumber: 0, title, explanation, command, riskLevel };
    if (warning.kind === 'empty') step.warningMessage = '';
    if (warning.kind === 'text') step.warningMessage = warning.text;
    if (backup !== undefined) step.backupPrerequisite = backup;
    return step;
  });

const arbUnclassifiedResult: fc.Arbitrary<AnalysisResult> = fc
  .record({
    steps: fc.array(arbUnclassifiedStep, { minLength: 1, maxLength: 6 }),
    analysisMode: fc.constantFrom<AnalysisResult['analysisMode']>('bedrock_ai', 'fallback_demo'),
    summary: arbSafeText(),
  })
  .map(({ steps, analysisMode, summary }) => ({
    incidentType: 'unknown',
    title: 'Generated incident',
    confidence: 'low',
    severity: 'medium',
    analysisMode,
    summary,
    detectedEvidence: [],
    assumptions: [],
    recoverySteps: steps.map((s, i) => ({ ...s, stepNumber: i + 1 })),
  }));

describe('Property 25: Unclassified destructive steps get a warning', () => {
  it('destructive unclassified steps without a warning get GENERIC_DESTRUCTIVE_WARNING; others are unchanged', () => {
    fc.assert(
      fc.property(arbUnclassifiedResult, (result) => {
        // Precondition: no step contains a Risky_Command.
        for (const step of result.recoverySteps) {
          expect(classifyCommand(step.command)).toEqual([]);
        }

        const output = validateSafety(result).recoverySteps;

        // No Safeguard_Steps inserted.
        expect(output).toHaveLength(result.recoverySteps.length);

        output.forEach((out, i) => {
          const input = result.recoverySteps[i];
          expect(out.command).toBe(input.command);
          expect(out.title).toBe(input.title);
          expect(out.explanation).toBe(input.explanation);
          expect(out.riskLevel).toBe(input.riskLevel);
          expect(out.stepNumber).toBe(i + 1);
          expect(out.backupPrerequisite).toBe(input.backupPrerequisite);
          expect('backupPrerequisite' in out).toBe('backupPrerequisite' in input);

          const inputWarning = input.warningMessage;
          if (input.riskLevel === 'destructive' && !inputWarning) {
            expect(out.warningMessage).toBe(GENERIC_DESTRUCTIVE_WARNING);
            expect(out.warningMessage!.length).toBeGreaterThan(0);
            expect(out.warningMessage).toMatch(/discard work or rewrite history/);
            expect(out.warningMessage).toMatch(/git status/);
          } else {
            // Non-empty warnings are unchanged; safe/caution steps get no warning added.
            expect(out.warningMessage).toBe(inputWarning);
            expect('warningMessage' in out).toBe('warningMessage' in input);
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});
