// Feature: gitpulse-recovery-assistant, Property 11: Invalid Bedrock responses fall back
/**
 * For any Bedrock response that fails `acceptBedrockResult` (arbitrary JSON,
 * contract violations, wrong `analysisMode`, overclaim phrases in
 * Risky_Steps, duplicated Residual_Risk_Label) and for any error status, the
 * Analyzer returns `applyConfidenceCap(validateSafety(analyzeFallback(text)))`
 * with `analysisMode` `fallback_demo` and a `fallbackReason`; `bedrock_ai`
 * appears only when the response is accepted.
 *
 * **Validates: Requirements 9.5, 19.3, 19.6, 11.16**
 */

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  RESIDUAL_RISK_LABEL,
  SAFETY_OVERCLAIM_PHRASES,
  type AnalysisResult,
} from '../../src/shared/analysisContract';
import { acceptBedrockResult, analyze, applyConfidenceCap, type AnalyzerDeps } from '../../src/lib/analyzer/analyzer';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { arbAnalysisResult, arbIncidentText } from '../arbitraries';

const ENDPOINT = 'https://example.test/analyze';

function fakeResponse(status: number, raw: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => raw } as unknown as Response;
}

function depsFor(status: number, raw: string): { deps: AnalyzerDeps; fetchFn: ReturnType<typeof vi.fn> } {
  const fetchFn = vi.fn(async () => fakeResponse(status, raw));
  return { fetchFn, deps: { endpointUrl: ENDPOINT, fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 15_000 } };
}

function expectedFallback(text: string): AnalysisResult {
  return applyConfidenceCap(validateSafety(analyzeFallback(text)));
}

const arbText = arbIncidentText().map((g) => g.text);

/** Valid Bedrock-mode results whose input warnings may carry the label once or an overclaim. */
const arbValidBedrock = arbAnalysisResult({ mode: 'bedrock_ai', warnings: { allowOverclaim: false, allowLabel: true } });

type Json = Record<string, unknown>;
const clone = (r: AnalysisResult): Json => JSON.parse(JSON.stringify(r)) as Json;

/** Contract violations derived from a valid result (each fails `isAnalysisResult`). */
const arbContractViolation: fc.Arbitrary<unknown> = fc
  .tuple(
    arbValidBedrock,
    fc.constantFrom(
      'unknownTopKey',
      'unknownStepKey',
      'badIncidentType',
      'badConfidence',
      'badSeverity',
      'badRiskLevel',
      'titleNotString',
      'evidenceNotArray',
      'stepNumberString',
      'emptySteps',
      'nonConsecutive',
      'fallbackMode',
      'missingSummary',
    ),
    fc.nat(),
  )
  .map(([valid, kind, seed]) => {
    const body = clone(valid);
    const steps = body.recoverySteps as Json[];
    const i = seed % steps.length;
    switch (kind) {
      case 'unknownTopKey':
        body.extra = true;
        break;
      case 'unknownStepKey':
        steps[i]!.extra = 'x';
        break;
      case 'badIncidentType':
        body.incidentType = 'force_push';
        break;
      case 'badConfidence':
        body.confidence = 'certain';
        break;
      case 'badSeverity':
        body.severity = 'critical';
        break;
      case 'badRiskLevel':
        steps[i]!.riskLevel = 'dangerous';
        break;
      case 'titleNotString':
        body.title = 42;
        break;
      case 'evidenceNotArray':
        body.detectedEvidence = 'evidence';
        break;
      case 'stepNumberString':
        steps[i]!.stepNumber = String(steps[i]!.stepNumber);
        break;
      case 'emptySteps':
        body.recoverySteps = [];
        break;
      case 'nonConsecutive':
        steps[i]!.stepNumber = (steps[i]!.stepNumber as number) + steps.length + 1;
        break;
      case 'fallbackMode':
        body.analysisMode = 'fallback_demo';
        break;
      case 'missingSummary':
        delete body.summary;
        break;
    }
    return body;
  });

/** Valid results with a Safety_Overclaim_Phrase in a Risky_Step title, explanation, or warning. */
const arbOverclaim: fc.Arbitrary<unknown> = fc
  .tuple(
    arbValidBedrock.filter((r) => r.recoverySteps.some((s) => classifyCommand(s.command).length > 0)),
    fc.constantFrom('title', 'explanation', 'warningMessage'),
    fc.constantFrom(...SAFETY_OVERCLAIM_PHRASES),
    fc.boolean(),
    fc.nat(),
  )
  .map(([valid, field, phrase, upper, seed]) => {
    const body = clone(valid);
    const steps = body.recoverySteps as Json[];
    const risky = steps.filter((s) => classifyCommand(s.command as string).length > 0);
    const step = risky[seed % risky.length]!;
    const text = ` This is ${upper ? phrase.toUpperCase() : phrase}.`;
    step[field] = `${(step[field] as string | undefined) ?? 'Warning.'}${text}`;
    return body;
  });

/** Valid results where some step's warningMessage contains the Residual_Risk_Label twice or more. */
const arbDuplicateLabel: fc.Arbitrary<unknown> = fc
  .tuple(arbValidBedrock, fc.nat(), fc.integer({ min: 2, max: 3 }))
  .map(([valid, seed, times]) => {
    const body = clone(valid);
    const steps = body.recoverySteps as Json[];
    const step = steps[seed % steps.length]!;
    step.warningMessage = Array.from({ length: times }, () => `${RESIDUAL_RISK_LABEL}.`).join(' ');
    return body;
  });

const arbInvalidBody: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue(),
  arbContractViolation,
  arbOverclaim,
  arbDuplicateLabel,
);

describe('Property 11: Invalid Bedrock responses fall back', () => {
  it('falls back with bedrock_invalid for any rejected 200 response body', async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbInvalidBody, async (text, body) => {
        expect(acceptBedrockResult(body)).toBeNull();
        const { deps, fetchFn } = depsFor(200, JSON.stringify(body));
        const outcome = await analyze(text, deps);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(outcome.fallbackReason).toBe('bedrock_invalid');
        expect(outcome.result.analysisMode).toBe('fallback_demo');
        expect(outcome.result).toEqual(expectedFallback(text));
      }),
      { numRuns: 100 },
    );
  });

  it('falls back with bedrock_error for any non-2xx status, even with a valid body', async () => {
    const arbStatus = fc.oneof(fc.integer({ min: 300, max: 599 }), fc.integer({ min: 100, max: 199 }));
    await fc.assert(
      fc.asyncProperty(arbText, arbStatus, fc.oneof(arbValidBedrock, arbInvalidBody), async (text, status, body) => {
        const { deps } = depsFor(status, JSON.stringify(body));
        const outcome = await analyze(text, deps);
        expect(outcome.fallbackReason).toBe('bedrock_error');
        expect(outcome.result.analysisMode).toBe('fallback_demo');
        expect(outcome.result).toEqual(expectedFallback(text));
      }),
      { numRuns: 100 },
    );
  });

  it('carries bedrock_ai only when the response is accepted', async () => {
    await fc.assert(
      fc.asyncProperty(arbText, fc.oneof(arbValidBedrock, arbInvalidBody), async (text, body) => {
        const accepted = acceptBedrockResult(body);
        const outcome = await analyze(text, depsFor(200, JSON.stringify(body)).deps);
        if (accepted === null) {
          expect(outcome.result.analysisMode).toBe('fallback_demo');
          expect(outcome.fallbackReason).toBe('bedrock_invalid');
        } else {
          expect(outcome.fallbackReason).toBeUndefined();
          expect(outcome.result.analysisMode).toBe('bedrock_ai');
          expect(outcome.result).toEqual(applyConfidenceCap(validateSafety(accepted)));
        }
      }),
      { numRuns: 100 },
    );
  });
});
