// Feature: gitpulse-recovery-assistant, Property 8: Confidence is capped by evidence
/**
 * Property 8: For any Analysis_Result returned by the Analyzer (from either
 * mode), fewer than 2 `detectedEvidence` entries means `confidence` is not
 * `high`; and for any plain-language Incident_Text without terminal-output
 * lines, the Fallback_Engine's `confidence` is `medium` or `low`.
 *
 * **Validates: Requirements 10.5, 10.6**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyze, type AnalyzerDeps } from '../../src/lib/analyzer/analyzer';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { arbAnalysisResult, arbIncidentText, arbPlainLanguageText } from '../arbitraries';

const ENDPOINT = 'https://example.test/analyze';

function okFetch(body: unknown): typeof fetch {
  const raw = JSON.stringify(body);
  return (async () => ({ ok: true, status: 200, text: async () => raw }) as unknown as Response) as typeof fetch;
}

const failingFetch: typeof fetch = (async () => {
  throw new TypeError('network down');
}) as typeof fetch;

function deps(fetchFn: typeof fetch, endpointUrl?: string): AnalyzerDeps {
  return endpointUrl === undefined ? { fetchFn, timeoutMs: 15_000 } : { endpointUrl, fetchFn, timeoutMs: 15_000 };
}

describe('Property 8: Confidence is capped by evidence', () => {
  it('plain-language input yields medium or low Fallback_Engine confidence', () => {
    fc.assert(
      fc.property(arbPlainLanguageText(), ({ text }) => {
        expect(['medium', 'low']).toContain(analyzeFallback(text).confidence);
      }),
      { numRuns: 100 },
    );
  });

  it('Analyzer fallback output with fewer than 2 evidence entries is never high', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(arbIncidentText(), arbPlainLanguageText()),
        fc.constantFrom<'none' | 'error'>('none', 'error'),
        async ({ text }, kind) => {
          const outcome =
            kind === 'none' ? await analyze(text, deps(failingFetch)) : await analyze(text, deps(failingFetch, ENDPOINT));
          expect(outcome.result.analysisMode).toBe('fallback_demo');
          if (outcome.result.detectedEvidence.length < 2) {
            expect(outcome.result.confidence).not.toBe('high');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepted Bedrock output is capped below 2 evidence entries and preserved otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnalysisResult({ mode: 'bedrock_ai' }), arbIncidentText(), async (body, { text }) => {
        const outcome = await analyze(text, deps(okFetch(body), ENDPOINT));
        expect(outcome.fallbackReason).toBeUndefined();
        expect(outcome.result.analysisMode).toBe('bedrock_ai');
        expect(outcome.result.detectedEvidence).toEqual(body.detectedEvidence);
        if (body.detectedEvidence.length < 2) {
          expect(outcome.result.confidence).not.toBe('high');
          expect(outcome.result.confidence).toBe(body.confidence === 'high' ? 'medium' : body.confidence);
        } else {
          expect(outcome.result.confidence).toBe(body.confidence);
        }
      }),
      { numRuns: 100 },
    );
  });
});
