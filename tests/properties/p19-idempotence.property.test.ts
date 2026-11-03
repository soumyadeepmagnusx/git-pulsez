// Feature: gitpulse-recovery-assistant, Property 19: Safety validation is idempotent
/**
 * For any Analysis_Result `r` (from either Analysis_Mode),
 * `validateSafety(validateSafety(r))` is deeply equal to `validateSafety(r)`.
 *
 * Run explicitly for each Analysis_Mode (Req 16.12), including inputs whose
 * warnings already contain the Residual_Risk_Label once. Also checks that
 * validateSafety does not mutate its input and preserves analysisMode.
 *
 * **Validates: Requirements 11.14, 16.12**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_MODES,
  RESIDUAL_RISK_LABEL,
  type AnalysisResult,
} from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAnalysisResult } from '../arbitraries';

/** Ensures every step's warning contains the Residual_Risk_Label exactly once. */
function withLabelInEveryWarning(r: AnalysisResult): AnalysisResult {
  return {
    ...r,
    recoverySteps: r.recoverySteps.map((s) => {
      const w = s.warningMessage ?? '';
      if (w.includes(RESIDUAL_RISK_LABEL)) return s;
      return { ...s, warningMessage: `${w}${w ? ' ' : ''}${RESIDUAL_RISK_LABEL}.` };
    }),
  };
}

function checkIdempotent(r: AnalysisResult): void {
  const snapshot = structuredClone(r);
  const once = validateSafety(r);
  expect(r).toStrictEqual(snapshot); // input not mutated
  expect(once.analysisMode).toBe(r.analysisMode);

  const onceSnapshot = structuredClone(once);
  const twice = validateSafety(once);
  expect(once).toStrictEqual(onceSnapshot); // first output not mutated
  expect(twice).toStrictEqual(once);
  expect(twice.analysisMode).toBe(r.analysisMode);
}

describe('Property 19: Safety validation is idempotent', () => {
  for (const mode of ANALYSIS_MODES) {
    it(`validateSafety(validateSafety(r)) equals validateSafety(r) for ${mode}`, () => {
      fc.assert(
        fc.property(arbAnalysisResult({ mode }), (r) => {
          expect(r.analysisMode).toBe(mode);
          checkIdempotent(r);
        }),
        { numRuns: 100 },
      );
    });

    it(`is idempotent for ${mode} inputs whose warnings already contain the residual label once`, () => {
      fc.assert(
        fc.property(arbAnalysisResult({ mode }).map(withLabelInEveryWarning), (r) => {
          expect(r.analysisMode).toBe(mode);
          checkIdempotent(r);
        }),
        { numRuns: 100 },
      );
    });
  }
});
