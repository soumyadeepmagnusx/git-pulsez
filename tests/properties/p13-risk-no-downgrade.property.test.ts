// Feature: gitpulse-recovery-assistant, Property 13: Risk level never decreases
/**
 * For any Analysis_Result and any Safeguard_Window content (empty, partial, or
 * complete), each original step's output `riskLevel` equals
 * `maxRisk(input riskLevel, classified level)`; for Risky_Steps this is
 * `caution` or `destructive`, and for steps without a Risky_Command it equals
 * the input `riskLevel`.
 *
 * The classified level comes from the generator's reference model
 * (`expected` levels, i.e. REFERENCE_LEVELS), not from the classifier under test.
 *
 * **Validates: Requirements 11.2, 11.3, 11.20, 14.12**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RISK_ORDER, maxRisk, type RecoveryStep, type RiskLevel } from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAnalysisResultWithMeta } from '../arbitraries';

const sameStep = (a: RecoveryStep, b: RecoveryStep): boolean =>
  a.command === b.command && a.title === b.title && a.explanation === b.explanation;

describe('Property 13: Risk level never decreases', () => {
  it('each original step keeps maxRisk(input, classified) and Risky_Steps are caution or destructive', () => {
    fc.assert(
      fc.property(arbAnalysisResultWithMeta(), ({ result, blocks }) => {
        // Reference classified level per original step (null = no Risky_Command).
        const classified: Array<RiskLevel | null> = blocks.flatMap((b) =>
          b.steps.map((_, i) => {
            if (b.risky === null || i !== b.steps.length - 1) return null;
            return b.risky.expected.map((e) => e.level).reduce<RiskLevel>(maxRisk, 'safe');
          }),
        );
        expect(classified).toHaveLength(result.recoverySteps.length);

        const output = validateSafety(result).recoverySteps;

        // Map original steps to output steps in order; unmatched output steps are inserted safeguards.
        let next = 0;
        for (const out of output) {
          if (next < result.recoverySteps.length && sameStep(out, result.recoverySteps[next])) {
            const input = result.recoverySteps[next];
            const level = classified[next];
            if (level === null) {
              expect(out.riskLevel).toBe(input.riskLevel);
            } else {
              expect(out.riskLevel).toBe(maxRisk(input.riskLevel, level));
              expect(['caution', 'destructive']).toContain(out.riskLevel);
            }
            expect(RISK_ORDER[out.riskLevel]).toBeGreaterThanOrEqual(RISK_ORDER[input.riskLevel]);
            next++;
          } else {
            expect(out.riskLevel).toBe('safe');
          }
        }
        expect(next).toBe(result.recoverySteps.length);
      }),
      { numRuns: 200 },
    );
  });
});
