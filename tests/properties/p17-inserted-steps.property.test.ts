// Feature: gitpulse-recovery-assistant, Property 17: Inserted safeguard steps are well-formed
/**
 * For any inserted Safeguard_Step, `riskLevel` is `safe`, `title` and
 * `explanation` are non-empty, the explanation states that the step reduces
 * risk but does not make the next step safe, and the explanation contains the
 * kind-specific statement (stash: saves tracked, staged, and untracked
 * non-ignored changes, ignored files not saved, `git stash pop` restores;
 * reset/checkout safeguards: does not protect ignored files or data outside
 * the repository; dry run: lists files and deletes none; remote log: listed
 * commits exist only on the remote and will be removed).
 *
 * **Validates: Requirements 11.10, 12.8, 12.12, 13.7, 14.10**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RecoveryStep } from '../../src/shared/analysisContract';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { type SafeguardSpec, safeguardSetFor, windowSatisfies } from '../../src/lib/safety/safeguards';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { type ExpectedRisky, arbAnalysisResultWithMeta, referenceSafeguardCommands } from '../arbitraries';

const RISK_NOTE = 'This step reduces risk but does not make the next step safe.';

/** Greedy ordered-subsequence prefix length of `specs` over the window commands. */
function greedyPrefix(windowCommands: readonly string[], specs: readonly SafeguardSpec[]): number {
  let k = 0;
  for (const command of windowCommands) {
    if (k < specs.length && windowSatisfies(command, specs[k])) k += 1;
  }
  return k;
}

interface ExpectedInsert {
  command: string;
  owner: ExpectedRisky;
}

function checkInsertedStep(step: RecoveryStep, expected: ExpectedInsert): void {
  const { owner } = expected;
  expect(step.command).toBe(expected.command);
  expect(step.riskLevel).toBe('safe');
  expect(step.title.trim().length).toBeGreaterThan(0);
  expect(step.explanation.trim().length).toBeGreaterThan(0);
  expect('warningMessage' in step).toBe(false);
  expect('backupPrerequisite' in step).toBe(false);
  expect(step.explanation.endsWith(RISK_NOTE)).toBe(true);

  const text = step.explanation.toLowerCase();

  if (owner.operation === 'reset_hard' || owner.operation === 'checkout_force') {
    expect(text).toContain('does not protect ignored files or data outside the repository');
  }

  if (expected.command === 'git stash push -u') {
    expect(text).toContain('saves tracked, staged, and untracked non-ignored changes');
    expect(text).toContain('ignored files are not saved');
    expect(text).toMatch(/git stash pop[^.]*restore/);
  }

  if (owner.operation === 'clean_force') {
    expect(text).toContain('lists the files');
    expect(text).toContain('deletes no files');
  }

  if (
    (owner.operation === 'push_force' || owner.operation === 'push_force_with_lease') &&
    expected.command.startsWith('git log ')
  ) {
    expect(text).toContain('exists only on the remote');
    expect(text).toMatch(/will be removed[^.]*by the force push/);
  }
}

describe('Property 17: Inserted safeguard steps are well-formed', () => {
  it('every inserted Safeguard_Step is safe, has no warning keys, and carries its kind-specific statements', () => {
    fc.assert(
      fc.property(arbAnalysisResultWithMeta(), ({ result, blocks }) => {
        // Expected output layout: null = original step, otherwise the inserted step's expectation.
        const layout: Array<ExpectedInsert | null> = [];
        let windowCommands: string[] = [];
        let index = 0;
        for (const block of blocks) {
          block.steps.forEach((_, i) => {
            const step = result.recoverySteps[index];
            index += 1;
            const isRisky = block.risky !== null && i === block.steps.length - 1;
            if (!isRisky) {
              layout.push(null);
              windowCommands.push(step.command);
              return;
            }
            const owners = block.risky!.expected.flatMap((e) => referenceSafeguardCommands(e).map(() => e));
            const specs = classifyCommand(step.command).flatMap(safeguardSetFor);
            expect(specs.map((s) => s.command)).toEqual(block.required);
            const k = greedyPrefix(windowCommands, specs);
            for (let j = k; j < block.required.length; j += 1) {
              layout.push({ command: block.required[j], owner: owners[j] });
            }
            layout.push(null);
            windowCommands = [];
          });
        }

        const output = validateSafety(result).recoverySteps;
        expect(output).toHaveLength(layout.length);
        output.forEach((step, i) => {
          const expected = layout[i];
          if (expected !== null) checkInsertedStep(step, expected);
        });
      }),
      { numRuns: 200 },
    );
  });
});
