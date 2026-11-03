import { describe, expect, it } from 'vitest';
import {
  containsOverclaim,
  isAnalysisResult,
  isHistoryEntry,
  maxRisk,
  SAFETY_OVERCLAIM_PHRASES,
  type AnalysisResult,
  type HistoryEntry,
  type RiskLevel,
} from '../../src/shared/analysisContract';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { SAMPLE_INCIDENTS } from '../../src/data/sampleIncidents';

// Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 11.22, 23.4

function validResult(): AnalysisResult {
  return {
    incidentType: 'rejected_push',
    title: 'Push rejected',
    confidence: 'medium',
    severity: 'medium',
    analysisMode: 'fallback_demo',
    summary: 'The remote has commits your local branch lacks.',
    detectedEvidence: ['! [rejected] main -> main (fetch first)'],
    assumptions: ['The remote is assumed to be origin.'],
    recoverySteps: [
      { stepNumber: 1, title: 'Inspect', explanation: 'Check state.', command: 'git status', riskLevel: 'safe' },
      {
        stepNumber: 2,
        title: 'Fetch',
        explanation: 'Fetch remote.',
        command: 'git fetch origin',
        riskLevel: 'caution',
        warningMessage: 'Review first.',
        backupPrerequisite: 'git status',
      },
    ],
  };
}

type Mutator = (r: Record<string, unknown>) => void;

function mutated(fn: Mutator): unknown {
  const r = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
  fn(r);
  return r;
}

function steps(r: Record<string, unknown>): Record<string, unknown>[] {
  return r.recoverySteps as Record<string, unknown>[];
}

describe('isAnalysisResult', () => {
  it('accepts a valid result in both Analysis_Modes', () => {
    expect(isAnalysisResult(validResult())).toBe(true);
    expect(isAnalysisResult({ ...validResult(), analysisMode: 'bedrock_ai' })).toBe(true);
  });

  it('accepts empty evidence and assumption arrays', () => {
    expect(isAnalysisResult({ ...validResult(), detectedEvidence: [], assumptions: [] })).toBe(true);
  });

  it.each(SAMPLE_INCIDENTS.map((s) => [s.id, s.incidentText] as const))(
    'accepts Fallback_Engine output for sample %s',
    (_id, text) => {
      expect(isAnalysisResult(analyzeFallback(text))).toBe(true);
    },
  );

  it('accepts Fallback_Engine output for unrecognized text', () => {
    const result = analyzeFallback('Something odd happened with my repository today.');
    expect(result.incidentType).toBe('unknown');
    expect(isAnalysisResult(result)).toBe(true);
  });

  it.each<[string, Mutator]>([
    ['bad incidentType', (r) => (r.incidentType = 'force_push')],
    ['bad confidence', (r) => (r.confidence = 'certain')],
    ['bad severity', (r) => (r.severity = 'critical')],
    ['bad analysisMode', (r) => (r.analysisMode = 'demo')],
    ['bad riskLevel', (r) => (steps(r)[0].riskLevel = 'dangerous')],
    ['enum with wrong case', (r) => (r.confidence = 'High')],
  ])('rejects %s', (_name, fn) => {
    expect(isAnalysisResult(mutated(fn))).toBe(false);
  });

  it.each<[string, Mutator]>([
    ['numeric title', (r) => (r.title = 42)],
    ['null summary', (r) => (r.summary = null)],
    ['evidence not an array', (r) => (r.detectedEvidence = 'line')],
    ['non-string evidence entry', (r) => (r.detectedEvidence = ['ok', 1])],
    ['non-string assumption entry', (r) => (r.assumptions = [{}])],
    ['recoverySteps not an array', (r) => (r.recoverySteps = {})],
    ['numeric command', (r) => (steps(r)[0].command = 7)],
    ['non-string warningMessage', (r) => (steps(r)[1].warningMessage = true)],
    ['non-string backupPrerequisite', (r) => (steps(r)[1].backupPrerequisite = 3)],
    ['missing title', (r) => delete r.title],
    ['missing step explanation', (r) => delete steps(r)[0].explanation],
  ])('rejects wrong type or missing field: %s', (_name, fn) => {
    expect(isAnalysisResult(mutated(fn))).toBe(false);
  });

  it('rejects an optional key set to undefined', () => {
    const r = validResult();
    (r.recoverySteps[0] as unknown as Record<string, unknown>).warningMessage = undefined;
    expect(isAnalysisResult(r)).toBe(false);
  });

  it('rejects unknown keys on the result and on a step', () => {
    expect(isAnalysisResult(mutated((r) => (r.extra = 'x')))).toBe(false);
    expect(isAnalysisResult(mutated((r) => (steps(r)[0].execute = true)))).toBe(false);
  });

  it('rejects empty recoverySteps', () => {
    expect(isAnalysisResult(mutated((r) => (r.recoverySteps = [])))).toBe(false);
  });

  it.each<[string, Mutator]>([
    ['non-integer stepNumber', (r) => (steps(r)[1].stepNumber = 1.5)],
    ['string stepNumber', (r) => (steps(r)[0].stepNumber = '1')],
    ['numbering starting at 0', (r) => { steps(r)[0].stepNumber = 0; steps(r)[1].stepNumber = 1; }],
    ['gap in numbering', (r) => (steps(r)[1].stepNumber = 3)],
    ['duplicate numbering', (r) => (steps(r)[1].stepNumber = 1)],
    ['out-of-order numbering', (r) => { steps(r)[0].stepNumber = 2; steps(r)[1].stepNumber = 1; }],
  ])('rejects %s', (_name, fn) => {
    expect(isAnalysisResult(mutated(fn))).toBe(false);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'result'],
    ['a number', 1],
    ['an empty array', []],
    ['an array wrapping a valid result', [validResult()]],
  ])('rejects %s', (_name, value) => {
    expect(isAnalysisResult(value)).toBe(false);
  });
});

describe('JSON round trip (Req 9.6)', () => {
  it('preserves a valid result, including optional keys', () => {
    const r = validResult();
    const copy = JSON.parse(JSON.stringify(r));
    expect(copy).toEqual(r);
    expect(isAnalysisResult(copy)).toBe(true);
  });

  it('preserves Fallback_Engine output', () => {
    const r = analyzeFallback(SAMPLE_INCIDENTS[1].incidentText);
    const copy = JSON.parse(JSON.stringify(r));
    expect(copy).toStrictEqual(r);
    expect(isAnalysisResult(copy)).toBe(true);
  });
});

describe('isHistoryEntry', () => {
  const entry = (): HistoryEntry => ({
    id: 'h1',
    incidentText: 'error: failed to push some refs',
    result: validResult(),
    createdAt: 1_700_000_000_000,
  });

  it('accepts valid entries with and without fallbackReason', () => {
    expect(isHistoryEntry(entry())).toBe(true);
    expect(isHistoryEntry({ ...entry(), fallbackReason: 'bedrock_timeout' })).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['numeric id', { id: 1 }],
    ['non-string incidentText', { incidentText: null }],
    ['non-finite createdAt', { createdAt: Number.POSITIVE_INFINITY }],
    ['string createdAt', { createdAt: '2024-01-01' }],
    ['unknown fallbackReason', { fallbackReason: 'network' }],
    ['invalid result', { result: { ...validResult(), recoverySteps: [] } }],
    ['unknown key', { pinned: true }],
  ])('rejects %s', (_name, patch) => {
    expect(isHistoryEntry({ ...entry(), ...patch })).toBe(false);
  });

  it('rejects an entry missing a required key', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...rest } = entry();
    expect(isHistoryEntry(rest)).toBe(false);
  });
});

describe('containsOverclaim (Req 11.22)', () => {
  it.each(SAFETY_OVERCLAIM_PHRASES.map((p) => [p]))('detects "%s" in any case', (phrase) => {
    expect(containsOverclaim(`This is ${phrase}.`)).toBe(true);
    expect(containsOverclaim(`This is ${phrase.toUpperCase()}.`)).toBe(true);
    expect(containsOverclaim(`Mixed: ${phrase.replace(/^./, (c) => c.toUpperCase())}`)).toBe(true);
  });

  it('returns false for text without overclaims', () => {
    expect(containsOverclaim('')).toBe(false);
    expect(containsOverclaim('This step reduces risk but does not make the next step safe.')).toBe(false);
    expect(containsOverclaim('Risk remains after safeguards.')).toBe(false);
  });
});

describe('maxRisk', () => {
  const levels: RiskLevel[] = ['safe', 'caution', 'destructive'];

  it('returns the more severe level for every pair, in either order', () => {
    for (let i = 0; i < levels.length; i++) {
      for (let j = 0; j < levels.length; j++) {
        const expected = levels[Math.max(i, j)];
        expect(maxRisk(levels[i], levels[j])).toBe(expected);
      }
    }
  });

  it('never downgrades', () => {
    expect(maxRisk('destructive', 'safe')).toBe('destructive');
    expect(maxRisk('caution', 'safe')).toBe('caution');
    expect(maxRisk('safe', 'caution')).toBe('caution');
  });
});
