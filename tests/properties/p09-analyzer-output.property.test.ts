// Feature: gitpulse-recovery-assistant, Property 9: Analyzer output is well-formed
/**
 * For any Incident_Text accepted by input validation and any Bedrock behavior,
 * the Analyzer resolves to a result that passes `isAnalysisResult`, has at
 * least 1 Recovery_Step numbered 1..n, and carries `bedrock_ai` only when an
 * accepted Bedrock response was returned; otherwise `fallback_demo`, with a
 * `fallbackReason` set if and only if an endpoint was configured.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 19.5**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { acceptBedrockResult, analyze, type AnalyzerDeps } from '../../src/lib/analyzer/analyzer';
import { validateIncidentText } from '../../src/lib/input/validateIncidentText';
import { isAnalysisResult } from '../../src/shared/analysisContract';
import { arbAnalysisResult, arbIncidentText, arbPlainLanguageText } from '../arbitraries';

const ENDPOINT = 'https://api.example.com/analyze';

type Behavior =
  | { kind: 'no_endpoint' }
  | { kind: 'network_error' }
  | { kind: 'non_2xx'; status: number }
  | { kind: 'timeout' }
  | { kind: 'invalid_json'; raw: string }
  | { kind: 'body'; body: unknown };

function fakeResponse(status: number, raw: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => raw } as unknown as Response;
}

function fetchFor(behavior: Behavior): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    switch (behavior.kind) {
      case 'no_endpoint':
        throw new Error('fetch must not be called without an endpoint');
      case 'network_error':
        throw new TypeError('Failed to fetch');
      case 'non_2xx':
        return fakeResponse(behavior.status, '{"error":"boom"}');
      case 'timeout':
        // Never resolves; rejects only when the Analyzer aborts the request.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      case 'invalid_json':
        return fakeResponse(200, behavior.raw);
      case 'body':
        return fakeResponse(200, JSON.stringify(behavior.body));
    }
  }) as typeof fetch;
}

const arbInvalidJson: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('', 'not json', '{', '<html>error</html>', '{"incidentType":'),
  fc.string().filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  }),
);

const arbBehavior: fc.Arbitrary<Behavior> = fc.oneof(
  fc.constant<Behavior>({ kind: 'no_endpoint' }),
  fc.constant<Behavior>({ kind: 'network_error' }),
  fc.constantFrom(400, 404, 429, 500, 502, 503).map((status): Behavior => ({ kind: 'non_2xx', status })),
  fc.constant<Behavior>({ kind: 'timeout' }),
  arbInvalidJson.map((raw): Behavior => ({ kind: 'invalid_json', raw })),
  // Invalid bodies: arbitrary JSON, wrong analysisMode, adversarial warnings.
  fc.jsonValue().map((body): Behavior => ({ kind: 'body', body })),
  arbAnalysisResult({ mode: 'fallback_demo' }).map((body): Behavior => ({ kind: 'body', body })),
  arbAnalysisResult({ mode: 'bedrock_ai', warnings: { allowOverclaim: true, allowLabel: true } }).map(
    (body): Behavior => ({ kind: 'body', body }),
  ),
  // Valid Bedrock body.
  { weight: 2, arbitrary: arbAnalysisResult({ mode: 'bedrock_ai' }).map((body): Behavior => ({ kind: 'body', body })) },
);

const arbText: fc.Arbitrary<string> = fc
  .oneof(
    arbIncidentText().map((g) => g.text),
    arbPlainLanguageText().map((g) => g.text),
  )
  .filter((t) => validateIncidentText(t).ok);

describe('Property 9: Analyzer output is well-formed', () => {
  it('returns a contract-valid, consecutively numbered result with the correct analysisMode', async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbBehavior, async (text, behavior) => {
        const deps: AnalyzerDeps =
          behavior.kind === 'no_endpoint'
            ? { fetchFn: fetchFor(behavior), timeoutMs: 5 }
            : { endpointUrl: ENDPOINT, fetchFn: fetchFor(behavior), timeoutMs: 5 };

        const outcome = await analyze(text, deps);
        const { result } = outcome;

        expect(isAnalysisResult(result)).toBe(true);
        expect(result.recoverySteps.length).toBeGreaterThanOrEqual(1);
        result.recoverySteps.forEach((step, i) => expect(step.stepNumber).toBe(i + 1));

        const accepted = behavior.kind === 'body' && acceptBedrockResult(behavior.body) !== null;
        if (accepted) {
          expect(result.analysisMode).toBe('bedrock_ai');
          expect(outcome.fallbackReason).toBeUndefined();
        } else {
          expect(result.analysisMode).toBe('fallback_demo');
          if (behavior.kind === 'no_endpoint') {
            expect(outcome.fallbackReason).toBeUndefined();
          } else {
            expect(outcome.fallbackReason).toBeDefined();
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
