// Feature: gitpulse-recovery-assistant, Property 18: Renumbering and backup prerequisites
/**
 * **Validates: Requirements 11.11, 11.12**
 *
 * For any validated Analysis_Result, `stepNumber` values are 1..n in array
 * order, and every Risky_Step's `backupPrerequisite` equals the canonical
 * commands of its required Safeguard_Set joined with ' then ' (overwriting
 * any input value). Non-risky original steps keep their input
 * `backupPrerequisite` (an absent key stays absent).
 *
 * The expected required commands come from the generator's reference model
 * (`GeneratedBlock.required`), not from the src safeguard code.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAnalysisResultWithMeta } from '../arbitraries';

const MARKER = ' #orig-';

describe('Property 18: Renumbering and backup prerequisites', () => {
  it('numbers output steps 1..n and sets Risky_Step backupPrerequisite to the required commands joined with " then "', () => {
    fc.assert(
      fc.property(arbAnalysisResultWithMeta(), ({ result, blocks }) => {
        // Reference required commands per original step ([] for non-risky steps).
        const requiredPerStep: (string[] | null)[] = blocks.flatMap((b) =>
          b.steps.map((_, i) => (b.risky && i === b.steps.length - 1 ? b.required : null)),
        );
        expect(requiredPerStep).toHaveLength(result.recoverySteps.length);

        // Tag original titles so they can be told apart from inserted Safeguard_Steps.
        const input: AnalysisResult = {
          ...result,
          recoverySteps: result.recoverySteps.map((s, i) => ({ ...s, title: `${s.title}${MARKER}${i}` })),
        };
        const output = validateSafety(input);

        // Renumbering: 1..n in array order.
        output.recoverySteps.forEach((s, i) => expect(s.stepNumber).toBe(i + 1));

        const originals = output.recoverySteps.filter((s) => s.title.includes(MARKER));
        expect(originals).toHaveLength(input.recoverySteps.length);

        originals.forEach((out, i) => {
          const inStep = input.recoverySteps[i];
          expect(out.title).toBe(inStep.title);
          const required = requiredPerStep[i];
          if (required) {
            expect(out.backupPrerequisite).toBe(required.join(' then '));
          } else if ('backupPrerequisite' in inStep) {
            expect(out.backupPrerequisite).toBe(inStep.backupPrerequisite);
          } else {
            expect('backupPrerequisite' in out).toBe(false);
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});
