// Feature: gitpulse-recovery-assistant, Property 21: Original steps keep order and content
/**
 * **Validates: Requirements 11.15**
 *
 * For any Analysis_Result, removing the inserted Safeguard_Steps from the
 * validated output yields the original steps in their original order, with
 * every field equal to the input except `stepNumber`, a `riskLevel` that is
 * equal or more severe, a `warningMessage` that has the input as a prefix, and
 * `backupPrerequisite` on Risky_Steps. Non-step result fields are unchanged.
 *
 * Which original steps are Risky_Steps comes from the generator's block
 * structure, not from the classifier.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RISK_ORDER, type AnalysisResult } from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAnalysisResultWithMeta } from '../arbitraries';

const MARKER = ' #orig-';
const STEP_KEYS = ['stepNumber', 'title', 'explanation', 'command', 'riskLevel', 'warningMessage', 'backupPrerequisite'];

describe('Property 21: Original steps keep order and content', () => {
  it('keeps original steps in order with only the allowed field changes', () => {
    fc.assert(
      fc.property(arbAnalysisResultWithMeta(), ({ result, blocks }) => {
        const isRisky: boolean[] = blocks.flatMap((b) => b.steps.map((_, i) => b.risky !== null && i === b.steps.length - 1));
        expect(isRisky).toHaveLength(result.recoverySteps.length);

        // Tag original titles so inserted Safeguard_Steps can be told apart.
        const input: AnalysisResult = {
          ...result,
          recoverySteps: result.recoverySteps.map((s, i) => ({ ...s, title: `${s.title}${MARKER}${i}` })),
        };
        const snapshot = structuredClone(input);
        const output = validateSafety(input);

        // Input is not mutated.
        expect(input).toEqual(snapshot);

        // Non-step fields are unchanged and no top-level keys are added or removed.
        const { recoverySteps: outSteps, ...outRest } = output;
        const { recoverySteps: inSteps, ...inRest } = input;
        expect(outRest).toEqual(inRest);
        expect(Object.keys(output).sort()).toEqual(Object.keys(input).sort());

        // Renumbering only: stepNumber is 1..n in array order.
        outSteps.forEach((s, i) => expect(s.stepNumber).toBe(i + 1));

        const originals = outSteps.filter((s) => s.title.includes(MARKER));
        expect(originals.map((s) => s.title)).toEqual(inSteps.map((s) => s.title));

        originals.forEach((out, i) => {
          const inStep = inSteps[i];
          for (const key of Object.keys(out)) expect(STEP_KEYS).toContain(key);
          expect(out.title).toBe(inStep.title);
          expect(out.explanation).toBe(inStep.explanation);
          expect(out.command).toBe(inStep.command);
          expect(RISK_ORDER[out.riskLevel]).toBeGreaterThanOrEqual(RISK_ORDER[inStep.riskLevel]);

          if (inStep.warningMessage) {
            expect(out.warningMessage?.startsWith(inStep.warningMessage)).toBe(true);
          }

          if (isRisky[i]) {
            expect(out.warningMessage).toBeTruthy();
            expect(out.backupPrerequisite).toBeTruthy();
          } else {
            expect(out.riskLevel).toBe(inStep.riskLevel);
            expect('backupPrerequisite' in out).toBe('backupPrerequisite' in inStep);
            expect(out.backupPrerequisite).toBe(inStep.backupPrerequisite);
            if (inStep.warningMessage) {
              expect(out.warningMessage).toBe(inStep.warningMessage);
            } else if (inStep.riskLevel !== 'destructive') {
              expect('warningMessage' in out).toBe(false);
            } else {
              expect(out.warningMessage).toBeTruthy();
            }
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});
