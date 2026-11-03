// Feature: gitpulse-recovery-assistant, Property 10: Analysis_Result JSON round trip
/**
 * For any valid Analysis_Result r, JSON.parse(JSON.stringify(r)) is deeply
 * equal to r and still passes isAnalysisResult.
 *
 * **Validates: Requirements 9.6**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isAnalysisResult, type AnalysisResult } from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { arbAnalysisResult, arbIncidentText, arbPlainLanguageText } from '../arbitraries';

function assertRoundTrip(r: AnalysisResult): void {
  expect(isAnalysisResult(r)).toBe(true);
  const copy: unknown = JSON.parse(JSON.stringify(r));
  expect(copy).toStrictEqual(r);
  expect(isAnalysisResult(copy)).toBe(true);
}

const arbUnicode = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 80 }),
  fc.string({ unit: 'grapheme', maxLength: 80 }),
);

/** Valid results whose free-text fields are replaced by arbitrary unicode strings. */
const arbUnicodeResult: fc.Arbitrary<AnalysisResult> = arbAnalysisResult().chain((r) =>
  fc
    .record({
      title: arbUnicode,
      summary: arbUnicode,
      detectedEvidence: fc.array(arbUnicode, { maxLength: 4 }),
      assumptions: fc.array(arbUnicode, { maxLength: 3 }),
      stepTexts: fc.array(
        fc.record({ title: arbUnicode, explanation: arbUnicode, warning: fc.option(arbUnicode, { nil: undefined }) }),
        { minLength: r.recoverySteps.length, maxLength: r.recoverySteps.length },
      ),
    })
    .map(({ stepTexts, ...fields }) => ({
      ...r,
      ...fields,
      recoverySteps: r.recoverySteps.map((s, i) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit warningMessage from the copy
        const { warningMessage: _w, ...rest } = s;
        const step = { ...rest, title: stepTexts[i].title, explanation: stepTexts[i].explanation };
        return stepTexts[i].warning === undefined ? step : { ...step, warningMessage: stepTexts[i].warning };
      }),
    })),
);

describe('Property 10: Analysis_Result JSON round trip', () => {
  it('holds for generated Analysis_Results in both modes', () => {
    fc.assert(fc.property(arbAnalysisResult(), assertRoundTrip), { numRuns: 200 });
  });

  it('holds for Safety_Validator outputs', () => {
    fc.assert(fc.property(arbAnalysisResult(), (r) => assertRoundTrip(validateSafety(r))), { numRuns: 100 });
  });

  it('holds for Fallback_Engine outputs (raw and validated)', () => {
    fc.assert(
      fc.property(fc.oneof(arbIncidentText(), arbPlainLanguageText()), (g) => {
        const raw = analyzeFallback(g.text);
        assertRoundTrip(raw);
        assertRoundTrip(validateSafety(raw));
      }),
      { numRuns: 100 },
    );
  });

  it('holds for results with arbitrary unicode in string fields', () => {
    fc.assert(
      fc.property(arbUnicodeResult, (r) => {
        assertRoundTrip(r);
        assertRoundTrip(validateSafety(r));
      }),
      { numRuns: 200 },
    );
  });
});
