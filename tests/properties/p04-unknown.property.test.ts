// Feature: gitpulse-recovery-assistant, Property 4: Unknown incidents are safe and low confidence
/**
 * For any text that contains no trigger of any supported type, analyzeFallback
 * returns incidentType `unknown`, confidence `low`, only `safe` Recovery_Steps,
 * and an assumption stating that the text could not be matched to a known
 * incident type.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { detectIncidentTypes } from '../../src/lib/fallback/patterns';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { analyze } from '../../src/lib/analyzer/analyzer';
import type { AnalysisResult } from '../../src/shared/analysisContract';
import { arbNoiseText } from '../arbitraries';

const UNKNOWN_ASSUMPTION = 'GitPulse could not match the incident text to a known incident type.';
const INSPECTION_COMMANDS = /^git (status|log|reflog)\b/;

const arbUnknownText: fc.Arbitrary<string> = fc.oneof(
  arbNoiseText(),
  fc.string({ maxLength: 500 }),
  fc.string({ unit: 'grapheme', maxLength: 200 }),
).filter((text) => detectIncidentTypes(text).length === 0);

function assertUnknownSafe(result: AnalysisResult): void {
  expect(result.incidentType).toBe('unknown');
  expect(result.confidence).toBe('low');
  expect(result.analysisMode).toBe('fallback_demo');
  expect(result.recoverySteps.length).toBeGreaterThan(0);
  for (const step of result.recoverySteps) {
    expect(step.riskLevel).toBe('safe');
    expect(step.command).toMatch(INSPECTION_COMMANDS);
    expect(classifyCommand(step.command)).toEqual([]);
  }
  expect(result.assumptions).toContain(UNKNOWN_ASSUMPTION);
}

const noFetch = (() => {
  throw new Error('fetch must not be called without an endpoint');
}) as unknown as typeof fetch;

describe('Property 4: Unknown incidents are safe and low confidence', () => {
  it('analyzeFallback, validateSafety, and analyze (no endpoint) return a safe, low-confidence unknown result', async () => {
    await fc.assert(
      fc.asyncProperty(arbUnknownText, async (text) => {
        const raw = analyzeFallback(text);
        assertUnknownSafe(raw);

        const validated = validateSafety(raw);
        assertUnknownSafe(validated);
        expect(validated.recoverySteps).toHaveLength(raw.recoverySteps.length);

        const { result, fallbackReason } = await analyze(text, { fetchFn: noFetch, timeoutMs: 15_000 });
        assertUnknownSafe(result);
        expect(fallbackReason).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });
});
