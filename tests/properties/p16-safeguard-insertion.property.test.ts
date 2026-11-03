// Feature: gitpulse-recovery-assistant, Property 16: Safeguard insertion is complete and minimal
/**
 * For any Analysis_Result, after validation each Risky_Step's Safeguard_Window
 * contains its full required Safeguard_Set as an ordered subsequence; and the
 * steps inserted before each Risky_Step are exactly `required[k..]`, where `k`
 * is the length of the longest leading portion of the required set found as an
 * ordered subsequence in the input window (zero inserted when `k` equals the
 * set length).
 *
 * **Validates: Requirements 11.8, 11.9, 11.13, 12.6**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RecoveryStep } from '../../src/shared/analysisContract';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { type SafeguardSpec, safeguardSetFor, windowSatisfies } from '../../src/lib/safety/safeguards';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAnalysisResultWithMeta } from '../arbitraries';

/** Greedy ordered-subsequence prefix length of `specs` over the window commands. */
function greedyPrefix(windowCommands: readonly string[], specs: readonly SafeguardSpec[]): number {
  let k = 0;
  for (const command of windowCommands) {
    if (k < specs.length && windowSatisfies(command, specs[k])) k += 1;
  }
  return k;
}

describe('Property 16: Safeguard insertion is complete and minimal', () => {
  it('inserts exactly required[k..] before each Risky_Step and leaves every window complete', () => {
    fc.assert(
      fc.property(arbAnalysisResultWithMeta(), ({ result, blocks }) => {
        // Flatten original steps and mark the Risky_Steps from the block structure.
        const originals: Array<{ step: RecoveryStep; required: string[] | null }> = [];
        let index = 0;
        for (const block of blocks) {
          block.steps.forEach((_, i) => {
            const isRisky = block.risky !== null && i === block.steps.length - 1;
            originals.push({ step: result.recoverySteps[index], required: isRisky ? block.required : null });
            index += 1;
          });
        }

        // Expected output: original steps with required[k..] inserted before each Risky_Step.
        const expectedCommands: string[] = [];
        const expectedInserted: boolean[] = [];
        const riskyOutputIndices: number[] = [];
        let windowCommands: string[] = [];
        for (const { step, required } of originals) {
          if (required === null) {
            expectedCommands.push(step.command);
            expectedInserted.push(false);
            windowCommands.push(step.command);
            continue;
          }
          const specs = classifyCommand(step.command).flatMap(safeguardSetFor);
          // Matcher oracle must describe the same required set as the reference.
          expect(specs.map((s) => s.command)).toEqual(required);
          const k = greedyPrefix(windowCommands, specs);
          for (const command of required.slice(k)) {
            expectedCommands.push(command);
            expectedInserted.push(true);
          }
          riskyOutputIndices.push(expectedCommands.length);
          expectedCommands.push(step.command);
          expectedInserted.push(false);
          windowCommands = [];
        }

        const output = validateSafety(result).recoverySteps;
        expect(output.map((s) => s.command)).toEqual(expectedCommands);
        output.forEach((s, i) => {
          if (expectedInserted[i]) expect(s.riskLevel).toBe('safe');
        });

        // Completeness: each output window (after the previous Risky_Step,
        // inserted steps included) contains the full required set in order.
        let start = 0;
        for (const riskyIndex of riskyOutputIndices) {
          const riskyStep = output[riskyIndex];
          const specs = classifyCommand(riskyStep.command).flatMap(safeguardSetFor);
          const window = output.slice(start, riskyIndex).map((s) => s.command);
          expect(greedyPrefix(window, specs)).toBe(specs.length);
          start = riskyIndex + 1;
        }
      }),
      { numRuns: 200 },
    );
  });
});
