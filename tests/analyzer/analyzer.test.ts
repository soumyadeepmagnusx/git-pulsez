import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESIDUAL_RISK_LABEL,
  isAnalysisResult,
  type AnalysisResult,
} from '../../src/shared/analysisContract';
import { acceptBedrockResult, analyze, applyConfidenceCap, type AnalyzerDeps } from '../../src/lib/analyzer/analyzer';
import { parseEndpointUrl } from '../../src/config';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { RESET_UNCOMMITTED } from '../../src/lib/safety/warnings';
import { SAMPLE_INCIDENTS } from '../../src/data/sampleIncidents';

const ENDPOINT = 'https://api.example.com/analyze';
const TEXT = SAMPLE_INCIDENTS.find((s) => s.id === 'merge_conflict')!.incidentText;

/** Expected Analyzer output when it uses the Fallback_Engine. */
function expectedFallback(text: string): AnalysisResult {
  return applyConfidenceCap(validateSafety(analyzeFallback(text)));
}

function fakeResponse(status: number, raw: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => raw,
  } as unknown as Response;
}

function jsonFetch(status: number, body: unknown) {
  // Parameters are typed so `mock.calls` exposes (url, init) to assertions.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => fakeResponse(status, JSON.stringify(body)));
}

function deps(fetchFn: typeof fetch, ...rest: [endpointUrl?: string | undefined]): AnalyzerDeps {
  const endpointUrl = rest.length === 0 ? ENDPOINT : rest[0];
  return endpointUrl === undefined ? { fetchFn, timeoutMs: 15_000 } : { endpointUrl, fetchFn, timeoutMs: 15_000 };
}

function bedrockResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    incidentType: 'lost_commits',
    title: 'Commits lost after reset',
    confidence: 'high',
    severity: 'high',
    analysisMode: 'bedrock_ai',
    summary: 'A hard reset moved the branch.',
    detectedEvidence: ['abc1234 HEAD@{0}: reset: moving to HEAD~1', 'reset: moving to HEAD~1'],
    assumptions: [],
    recoverySteps: [
      { stepNumber: 1, title: 'Inspect reflog', explanation: 'Find the lost commit.', command: 'git reflog', riskLevel: 'safe' },
      {
        stepNumber: 2,
        title: 'Reset the branch',
        explanation: 'Move the branch back.',
        command: 'git reset --hard HEAD~1',
        riskLevel: 'safe',
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseEndpointUrl', () => {
  it('accepts https URLs', () => {
    expect(parseEndpointUrl(ENDPOINT)).toBe(ENDPOINT);
    expect(parseEndpointUrl('  https://x.example.com/a  ')).toBe('https://x.example.com/a');
  });

  it.each([undefined, '', '   ', 'http://api.example.com', 'ftp://api.example.com', '/analyze', 'not a url', 'https://user:pw@api.example.com'])(
    'rejects %j',
    (raw) => {
      expect(parseEndpointUrl(raw)).toBeUndefined();
    },
  );
});

describe('analyze without a configured endpoint (Req 19.2)', () => {
  it('uses the Fallback_Engine and makes no network request', async () => {
    const fetchFn = vi.fn();
    const outcome = await analyze(TEXT, deps(fetchFn as unknown as typeof fetch, undefined));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcome.fallbackReason).toBeUndefined();
    expect(outcome.result).toEqual(expectedFallback(TEXT));
    expect(outcome.result.analysisMode).toBe('fallback_demo');
    expect(isAnalysisResult(outcome.result)).toBe(true);
  });

  it.each(['http://api.example.com/analyze', 'ftp://api.example.com', 'relative/path', ''])(
    'treats non-https endpoint %j as not configured',
    async (endpointUrl) => {
      const fetchFn = vi.fn();
      const outcome = await analyze(TEXT, deps(fetchFn as unknown as typeof fetch, endpointUrl));
      expect(fetchFn).not.toHaveBeenCalled();
      expect(outcome.fallbackReason).toBeUndefined();
      expect(outcome.result.analysisMode).toBe('fallback_demo');
    },
  );
});

describe('analyze with a configured endpoint', () => {
  it('sends exactly one POST with { incidentText } to the configured URL (Req 19.1, 18.9)', async () => {
    const fetchFn = jsonFetch(200, bedrockResult());
    await analyze(TEXT, deps(fetchFn as unknown as typeof fetch));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ incidentText: TEXT });
    expect(init?.credentials).toBe('omit');
  });

  it('accepts a valid Bedrock result, keeps bedrock_ai, and passes it through validateSafety (Req 11.16, 19.6)', async () => {
    const input = bedrockResult();
    const outcome = await analyze(TEXT, deps(jsonFetch(200, input) as unknown as typeof fetch));
    expect(outcome.fallbackReason).toBeUndefined();
    const { result } = outcome;
    expect(result.analysisMode).toBe('bedrock_ai');
    expect(result).toEqual(validateSafety(input));
    expect(result.recoverySteps.map((s) => s.command)).toEqual([
      'git reflog',
      'git status',
      'git stash push -u',
      'git reset --hard HEAD~1',
    ]);
    expect(result.recoverySteps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4]);
    const risky = result.recoverySteps[3]!;
    expect(risky.riskLevel).toBe('destructive');
    expect(risky.warningMessage).toContain(RESET_UNCOMMITTED);
    expect(risky.warningMessage!.split(RESIDUAL_RISK_LABEL)).toHaveLength(2);
    expect(risky.backupPrerequisite).toBe('git status then git stash push -u');
    expect(result.confidence).toBe('high');
  });

  it('caps confidence at medium when fewer than 2 evidence entries exist (Req 10.6)', async () => {
    const input = bedrockResult({ detectedEvidence: ['reset: moving to HEAD~1'] });
    const outcome = await analyze(TEXT, deps(jsonFetch(200, input) as unknown as typeof fetch));
    expect(outcome.result.analysisMode).toBe('bedrock_ai');
    expect(outcome.result.confidence).toBe('medium');

    const none = await analyze(TEXT, deps(jsonFetch(200, bedrockResult({ detectedEvidence: [] })) as unknown as typeof fetch));
    expect(none.result.confidence).toBe('medium');
  });

  it.each([400, 404, 500, 502, 503])('falls back with bedrock_error on HTTP %i', async (status) => {
    const outcome = await analyze(TEXT, deps(jsonFetch(status, bedrockResult()) as unknown as typeof fetch));
    expect(outcome.fallbackReason).toBe('bedrock_error');
    expect(outcome.result).toEqual(expectedFallback(TEXT));
  });

  it('falls back with bedrock_error when fetch rejects', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const outcome = await analyze(TEXT, deps(fetchFn as unknown as typeof fetch));
    expect(outcome.fallbackReason).toBe('bedrock_error');
    expect(outcome.result).toEqual(expectedFallback(TEXT));
  });

  it('falls back with bedrock_timeout after 15 s without a response (Req 19.3)', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    const pending = analyze(TEXT, deps(fetchFn as unknown as typeof fetch));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await pending;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(outcome.fallbackReason).toBe('bedrock_timeout');
    expect(outcome.result).toEqual(expectedFallback(TEXT));
  });

  it('falls back with bedrock_invalid when the body is not JSON', async () => {
    const fetchFn = vi.fn(async () => fakeResponse(200, '<html>oops</html>'));
    const outcome = await analyze(TEXT, deps(fetchFn as unknown as typeof fetch));
    expect(outcome.fallbackReason).toBe('bedrock_invalid');
    expect(outcome.result).toEqual(expectedFallback(TEXT));
  });

  const invalidBodies: Array<[string, unknown]> = [
    ['an empty object', {}],
    ['a contract violation (unknown key)', { ...bedrockResult(), extra: true }],
    ['empty recoverySteps', bedrockResult({ recoverySteps: [] })],
    ['the wrong analysisMode', bedrockResult({ analysisMode: 'fallback_demo' })],
    [
      'an overclaim phrase in a Risky_Step title',
      bedrockResult({
        recoverySteps: [
          { stepNumber: 1, title: 'This is now safe', explanation: 'Reset.', command: 'git reset --hard HEAD~1', riskLevel: 'destructive' },
        ],
      }),
    ],
    [
      'an overclaim phrase in a Risky_Step warning',
      bedrockResult({
        recoverySteps: [
          {
            stepNumber: 1,
            title: 'Force push',
            explanation: 'Push.',
            command: 'git push --force origin feature',
            riskLevel: 'destructive',
            warningMessage: 'This is Completely Safe.',
          },
        ],
      }),
    ],
    [
      'a duplicated Residual_Risk_Label',
      bedrockResult({
        recoverySteps: [
          {
            stepNumber: 1,
            title: 'Reset',
            explanation: 'Reset.',
            command: 'git reset --hard HEAD~1',
            riskLevel: 'destructive',
            warningMessage: `${RESIDUAL_RISK_LABEL}. ${RESIDUAL_RISK_LABEL}.`,
          },
        ],
      }),
    ],
  ];

  it.each(invalidBodies)('falls back with bedrock_invalid for %s (Req 9.5)', async (_name, body) => {
    expect(acceptBedrockResult(body)).toBeNull();
    const outcome = await analyze(TEXT, deps(jsonFetch(200, body) as unknown as typeof fetch));
    expect(outcome.fallbackReason).toBe('bedrock_invalid');
    expect(outcome.result).toEqual(expectedFallback(TEXT));
    expect(outcome.result.analysisMode).toBe('fallback_demo');
  });

  it('accepts an overclaim phrase on a non-risky step', () => {
    const body = bedrockResult({
      recoverySteps: [
        { stepNumber: 1, title: 'Status', explanation: 'This is safe to run.', command: 'git status', riskLevel: 'safe' },
      ],
    });
    expect(acceptBedrockResult(body)).not.toBeNull();
  });
});
