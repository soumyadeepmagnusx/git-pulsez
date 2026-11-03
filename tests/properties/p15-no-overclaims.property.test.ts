// Feature: gitpulse-recovery-assistant, Property 15: No safety overclaims
/**
 * For any Analysis_Result whose Risky_Step input warnings contain no
 * Safety_Overclaim_Phrase, every output Risky_Step `warningMessage` and every
 * inserted Safeguard_Step `explanation` (and `title`) contains zero
 * Safety_Overclaim_Phrases (case-insensitive).
 *
 * **Validates: Requirements 11.22**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsOverclaim, type RecoveryStep } from '../../src/shared/analysisContract';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAnalysisResult } from '../arbitraries';

function sameOriginal(out: RecoveryStep, orig: RecoveryStep): boolean {
  return out.command === orig.command && out.title === orig.title && out.explanation === orig.explanation;
}

/** Splits validated steps into original (matched in order) and inserted steps. */
function partition(input: readonly RecoveryStep[], output: readonly RecoveryStep[]) {
  const originals: RecoveryStep[] = [];
  const inserted: RecoveryStep[] = [];
  let i = 0;
  for (const step of output) {
    if (i < input.length && sameOriginal(step, input[i])) {
      originals.push(step);
      i += 1;
    } else {
      inserted.push(step);
    }
  }
  return { originals, inserted, matchedAll: i === input.length };
}

describe('Property 15: No safety overclaims', () => {
  it('validated Risky_Step warnings and inserted Safeguard_Steps contain no overclaim phrases', () => {
    fc.assert(
      fc.property(arbAnalysisResult({ warnings: { allowLabel: true } }), (input) => {
        // Precondition: no input warning contains an overclaim.
        for (const s of input.recoverySteps) {
          if (s.warningMessage !== undefined) fc.pre(!containsOverclaim(s.warningMessage));
        }

        const output = validateSafety(input);
        const { originals, inserted, matchedAll } = partition(input.recoverySteps, output.recoverySteps);
        expect(matchedAll).toBe(true);

        for (const step of originals) {
          if (classifyCommand(step.command).length > 0) {
            expect(step.warningMessage).toBeDefined();
            expect(containsOverclaim(step.warningMessage ?? '')).toBe(false);
          }
        }
        for (const step of inserted) {
          expect(containsOverclaim(step.explanation)).toBe(false);
          expect(containsOverclaim(step.title)).toBe(false);
          if (step.warningMessage !== undefined) expect(containsOverclaim(step.warningMessage)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
