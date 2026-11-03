/**
 * Idempotence (16.9, 11.14) and no-overclaim (16.16, 11.22) tests for the
 * Safety_Validator, run for both Analysis_Modes (16.12).
 */

import { describe, expect, it } from 'vitest';
import {
  type AnalysisMode,
  type AnalysisResult,
  type RecoveryStep,
  type RiskLevel,
  ANALYSIS_MODES,
  RESIDUAL_RISK_LABEL,
  SAFETY_OVERCLAIM_PHRASES,
  containsOverclaim,
} from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import {
  type SafeguardSpec,
  cleanDryRunSpec,
  fetchRemoteSpec,
  inspectBranchLogSpec,
  inspectRemoteLogSpec,
  inspectStatusSpec,
  listNoMergedSpec,
  preserveChangesSpec,
  safeguardSetFor,
} from '../../src/lib/safety/safeguards';
import { ALL_WARNING_TEXTS, RESIDUAL_RISK_SENTENCE, warningTextsFor } from '../../src/lib/safety/warnings';

const RISKY_COMMANDS = [
  'git reset --hard HEAD~1',
  'git clean -f',
  'git clean -fd',
  'git clean -fx',
  'git clean -fdx',
  'git clean -fX -- build/',
  'git push --force origin feature',
  'git push -f origin feature',
  'git push --force-with-lease origin feature',
  'git push --force-with-lease',
  'git checkout -f main',
  'git branch -D feature',
  'git branch -D',
  'git reset --hard && git clean -fdx',
];

const INPUT_WARNINGS: (string | undefined)[] = [undefined, '', 'Be careful with this command.'];
const INPUT_LEVELS: RiskLevel[] = ['safe', 'caution', 'destructive'];

function step(command: string, overrides: Partial<RecoveryStep> = {}): RecoveryStep {
  return {
    stepNumber: 1,
    title: `Run ${command}`,
    explanation: `This step runs ${command}.`,
    command,
    riskLevel: 'safe',
    ...overrides,
  };
}

function resultWith(mode: AnalysisMode, steps: RecoveryStep[]): AnalysisResult {
  return {
    incidentType: 'lost_commits',
    title: 'Test incident',
    confidence: 'medium',
    severity: 'high',
    analysisMode: mode,
    summary: 'Test summary.',
    detectedEvidence: ['evidence line'],
    assumptions: ['assumption'],
    recoverySteps: steps.map((s, i) => ({ ...s, stepNumber: i + 1 })),
  };
}

function riskyResult(mode: AnalysisMode, command: string, level: RiskLevel, warning?: string): AnalysisResult {
  const overrides: Partial<RecoveryStep> = { riskLevel: level };
  if (warning !== undefined) overrides.warningMessage = warning;
  return resultWith(mode, [step('git status'), step(command, overrides), step('git log --oneline -n 5')]);
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Every safeguard spec reachable from the risky command cases, plus placeholder variants. */
function allSafeguardSpecs(): SafeguardSpec[] {
  const fromCommands = RISKY_COMMANDS.flatMap((c) => classifyCommand(c).flatMap(safeguardSetFor));
  return [
    ...fromCommands,
    inspectStatusSpec(),
    preserveChangesSpec(),
    cleanDryRunSpec({ d: true, x: true, X: false, pathspecs: ['src/', 'my dir'] }),
    fetchRemoteSpec({ remote: 'origin', branch: '<branch>', remoteNamed: false, branchNamed: false }),
    inspectRemoteLogSpec({ remote: 'upstream', branch: 'main', remoteNamed: true, branchNamed: true }),
    inspectBranchLogSpec('<branch>'),
    listNoMergedSpec([]),
    listNoMergedSpec(['a', 'b']),
  ];
}

describe.each(ANALYSIS_MODES)('Safety_Validator idempotence and overclaims (%s)', (mode) => {
  describe('16.9 idempotence', () => {
    for (const command of RISKY_COMMANDS) {
      for (const level of INPUT_LEVELS) {
        for (const warning of INPUT_WARNINGS) {
          it(`${command} | input ${level} | warning ${JSON.stringify(warning)}`, () => {
            const once = validateSafety(riskyResult(mode, command, level, warning));
            const twice = validateSafety(once);
            expect(twice).toEqual(once);
            expect(once.analysisMode).toBe(mode);
          });
        }
      }
    }

    it('is idempotent for a plan with several risky steps and a partial window', () => {
      const input = resultWith(mode, [
        step('git status'),
        step('git reset --hard HEAD~1', { riskLevel: 'destructive' }),
        step('git fetch origin'),
        step('git push --force-with-lease origin feature', { riskLevel: 'caution', warningMessage: 'Check first.' }),
        step('git branch -D old'),
        step('git rm -rf build', { riskLevel: 'destructive' }),
      ]);
      const once = validateSafety(input);
      expect(validateSafety(once)).toEqual(once);
    });

    it('does not mutate its input', () => {
      const input = riskyResult(mode, 'git reset --hard HEAD~1', 'safe', 'Original.');
      const snapshot = structuredClone(input);
      validateSafety(input);
      expect(input).toEqual(snapshot);
    });
  });

  describe('16.16 no safety overclaims', () => {
    for (const command of RISKY_COMMANDS) {
      for (const warning of INPUT_WARNINGS) {
        it(`${command} | warning ${JSON.stringify(warning)}`, () => {
          const input = riskyResult(mode, command, 'safe', warning);
          const output = validateSafety(input);
          const originalCommands = new Set(input.recoverySteps.map((s) => s.command));
          const inserted = output.recoverySteps.filter((s) => !originalCommands.has(s.command));
          const riskySteps = output.recoverySteps.filter((s) => classifyCommand(s.command).length > 0);

          expect(riskySteps.length).toBeGreaterThan(0);
          for (const s of riskySteps) {
            expect(s.warningMessage).toBeDefined();
            expect(containsOverclaim(s.warningMessage ?? '')).toBe(false);
            expect(countOccurrences(s.warningMessage ?? '', RESIDUAL_RISK_LABEL)).toBe(1);
          }
          for (const s of inserted) {
            expect(containsOverclaim(s.explanation)).toBe(false);
            expect(containsOverclaim(s.title)).toBe(false);
          }
        });
      }
    }
  });
});

describe('containsOverclaim is case-insensitive', () => {
  it.each(SAFETY_OVERCLAIM_PHRASES)('detects "%s" in any case', (phrase) => {
    expect(containsOverclaim(`This is ${phrase.toUpperCase()}.`)).toBe(true);
    expect(containsOverclaim(`This is ${phrase}.`)).toBe(true);
  });
});

describe('warning and safeguard template constants (11.22, 11.6)', () => {
  it('no warning constant contains a Safety_Overclaim_Phrase', () => {
    for (const text of ALL_WARNING_TEXTS) {
      expect(containsOverclaim(text), text).toBe(false);
    }
  });

  it('only the residual sentence contains RESIDUAL_RISK_LABEL', () => {
    const withLabel = ALL_WARNING_TEXTS.filter((t) => t.toLowerCase().includes(RESIDUAL_RISK_LABEL.toLowerCase()));
    expect(withLabel).toEqual([RESIDUAL_RISK_SENTENCE]);
    expect(countOccurrences(RESIDUAL_RISK_SENTENCE, RESIDUAL_RISK_LABEL)).toBe(1);
  });

  it('generated warning texts for every risky case contain no overclaim and no residual label', () => {
    for (const command of RISKY_COMMANDS) {
      for (const risky of classifyCommand(command)) {
        for (const text of warningTextsFor(risky)) {
          expect(containsOverclaim(text), text).toBe(false);
          expect(text.includes(RESIDUAL_RISK_LABEL), text).toBe(false);
        }
      }
    }
  });

  it('no safeguard template title, explanation, or command contains an overclaim or the residual label', () => {
    const specs = allSafeguardSpecs();
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      for (const text of [spec.title, spec.explanation, spec.command]) {
        expect(containsOverclaim(text), text).toBe(false);
        expect(text.includes(RESIDUAL_RISK_LABEL), text).toBe(false);
      }
    }
  });
});
