/**
 * Safety_Validator invariants: no risk downgrade, warning preservation,
 * Safeguard_Window handling, non-risky commands, generic destructive warning,
 * renumbering, backupPrerequisite, and multi-command safeguards.
 *
 * Requirements: 16.7, 16.8, 16.10, 16.11, 16.12, 16.13, 11.2, 11.3, 11.4, 11.6,
 * 11.7, 11.8, 11.9, 11.11, 11.12, 11.13, 11.20, 11.21, 14.12
 */

import { describe, expect, it } from 'vitest';
import {
  type AnalysisMode,
  type AnalysisResult,
  type RecoveryStep,
  type RiskLevel,
  RESIDUAL_RISK_LABEL,
} from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import {
  BACKUP_BRANCH_LIMIT,
  BRANCH_REFLOG_LIMIT,
  CHECKOUT_FORCE,
  CLEAN_PERMANENT,
  CLEAN_X,
  GENERIC_DESTRUCTIVE_WARNING,
  LEASE_LIMITS,
  PUSH_FORCE_LEASE_ADVICE,
  PUSH_FORCE_OVERWRITE,
  RESET_UNCOMMITTED,
  STASH_IGNORED,
  STASH_NOT_GUARANTEE,
  UNPROTECTED_DATA,
  branchTagBackup,
  leaseConditions,
} from '../../src/lib/safety/warnings';

const MODES: AnalysisMode[] = ['fallback_demo', 'bedrock_ai'];

interface RiskyCase {
  command: string;
  level: Exclude<RiskLevel, 'safe'>;
  safeguards: string[];
  warnings: string[];
}

const RISKY_CASES: RiskyCase[] = [
  {
    command: 'git reset --hard HEAD~1',
    level: 'destructive',
    safeguards: ['git status', 'git stash push -u'],
    warnings: [RESET_UNCOMMITTED, BACKUP_BRANCH_LIMIT, STASH_NOT_GUARANTEE, STASH_IGNORED, UNPROTECTED_DATA],
  },
  { command: 'git clean -f', level: 'destructive', safeguards: ['git clean -n'], warnings: [CLEAN_PERMANENT] },
  { command: 'git clean -fd', level: 'destructive', safeguards: ['git clean -nd'], warnings: [CLEAN_PERMANENT] },
  {
    command: 'git clean -fx',
    level: 'destructive',
    safeguards: ['git clean -nx'],
    warnings: [CLEAN_PERMANENT, CLEAN_X],
  },
  {
    command: 'git clean -fdx',
    level: 'destructive',
    safeguards: ['git clean -ndx'],
    warnings: [CLEAN_PERMANENT, CLEAN_X],
  },
  {
    command: 'git push --force origin feature',
    level: 'destructive',
    safeguards: ['git fetch origin', 'git log --oneline HEAD..origin/feature'],
    warnings: [PUSH_FORCE_OVERWRITE, PUSH_FORCE_LEASE_ADVICE],
  },
  {
    command: 'git push -f origin feature',
    level: 'destructive',
    safeguards: ['git fetch origin', 'git log --oneline HEAD..origin/feature'],
    warnings: [PUSH_FORCE_OVERWRITE, PUSH_FORCE_LEASE_ADVICE],
  },
  {
    command: 'git push --force-with-lease origin feature',
    level: 'caution',
    safeguards: ['git fetch origin', 'git log --oneline HEAD..origin/feature'],
    warnings: [LEASE_LIMITS, leaseConditions('origin', 'feature')],
  },
  {
    command: 'git checkout -f main',
    level: 'destructive',
    safeguards: ['git status', 'git stash push -u'],
    warnings: [CHECKOUT_FORCE, STASH_NOT_GUARANTEE, STASH_IGNORED, UNPROTECTED_DATA],
  },
  {
    command: 'git branch -D feature',
    level: 'destructive',
    safeguards: ['git log --oneline feature', 'git branch --no-merged'],
    warnings: [BRANCH_REFLOG_LIMIT, branchTagBackup('feature')],
  },
];

function step(command: string, riskLevel: RiskLevel = 'safe', extra: Partial<RecoveryStep> = {}): RecoveryStep {
  return { stepNumber: 0, title: `Run ${command}`, explanation: `Explanation for ${command}.`, command, riskLevel, ...extra };
}

function result(mode: AnalysisMode, steps: RecoveryStep[]): AnalysisResult {
  return {
    incidentType: 'unknown',
    title: 'Test incident',
    confidence: 'low',
    severity: 'low',
    analysisMode: mode,
    summary: 'Test summary.',
    detectedEvidence: [],
    assumptions: [],
    recoverySteps: steps.map((s, i) => ({ ...s, stepNumber: i + 1 })),
  };
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function riskyOutput(out: AnalysisResult, command: string): RecoveryStep {
  const found = out.recoverySteps.find((s) => s.command === command);
  if (!found) throw new Error(`step ${command} missing`);
  return found;
}

const INPUT_WARNING = 'Custom input warning from the engine: double-check the branch.';

describe.each(MODES)('Safety_Validator invariants (%s)', (mode) => {
  describe('16.7 risk level never decreases', () => {
    it.each(RISKY_CASES)('$command with input safe is raised to $level', ({ command, level }) => {
      const out = validateSafety(result(mode, [step(command, 'safe')]));
      const risky = riskyOutput(out, command);
      expect(risky.riskLevel).toBe(level);
      expect(['caution', 'destructive']).toContain(risky.riskLevel);
    });

    it('git push --force-with-lease with input destructive stays destructive', () => {
      const command = 'git push --force-with-lease origin feature';
      const out = validateSafety(result(mode, [step(command, 'destructive')]));
      expect(riskyOutput(out, command).riskLevel).toBe('destructive');
    });

    it('git push --force-with-lease stays destructive with a complete window', () => {
      const command = 'git push --force-with-lease origin feature';
      const out = validateSafety(
        result(mode, [
          step('git fetch origin'),
          step('git log --oneline HEAD..origin/feature'),
          step(command, 'destructive'),
        ]),
      );
      expect(out.recoverySteps).toHaveLength(3);
      expect(riskyOutput(out, command).riskLevel).toBe('destructive');
    });
  });

  describe('16.8 non-empty input warning is preserved unchanged', () => {
    it.each(RISKY_CASES)('$command keeps the input warning as a prefix', ({ command }) => {
      const out = validateSafety(result(mode, [step(command, 'caution', { warningMessage: INPUT_WARNING })]));
      const warning = riskyOutput(out, command).warningMessage ?? '';
      expect(warning.startsWith(INPUT_WARNING)).toBe(true);
    });

    it('non-risky step keeps its warning unchanged', () => {
      const out = validateSafety(result(mode, [step('git status', 'caution', { warningMessage: INPUT_WARNING })]));
      expect(out.recoverySteps[0].warningMessage).toBe(INPUT_WARNING);
    });
  });

  describe('16.10 Safeguard_Window handling', () => {
    it.each(RISKY_CASES)('$command with a complete window inserts zero steps', ({ command, safeguards }) => {
      const input = result(mode, [...safeguards.map((c) => step(c)), step(command)]);
      const out = validateSafety(input);
      expect(out.recoverySteps.map((s) => s.command)).toEqual([...safeguards, command]);
    });

    it.each(RISKY_CASES.filter((c) => c.safeguards.length > 1))(
      '$command with only the leading safeguard inserts only the remaining ones',
      ({ command, safeguards }) => {
        const out = validateSafety(result(mode, [step(safeguards[0]), step(command)]));
        expect(out.recoverySteps.map((s) => s.command)).toEqual([...safeguards, command]);
        const inserted = out.recoverySteps.slice(1, safeguards.length);
        for (const s of inserted) expect(s.riskLevel).toBe('safe');
      },
    );

    it.each(RISKY_CASES)('$command with an empty window inserts the full set immediately before', ({ command, safeguards }) => {
      const out = validateSafety(result(mode, [step('git log --oneline -n 5'), step(command)]));
      expect(out.recoverySteps.map((s) => s.command)).toEqual(['git log --oneline -n 5', ...safeguards, command]);
    });

    it('safeguards before an earlier Risky_Step do not count for a later one', () => {
      const out = validateSafety(
        result(mode, [
          step('git status'),
          step('git stash push -u'),
          step('git reset --hard HEAD~1'),
          step('git checkout -f main'),
        ]),
      );
      expect(out.recoverySteps.map((s) => s.command)).toEqual([
        'git status',
        'git stash push -u',
        'git reset --hard HEAD~1',
        'git status',
        'git stash push -u',
        'git checkout -f main',
      ]);
    });
  });

  describe('16.11 non-risky commands', () => {
    const NON_RISKY = ['git clean -nd', 'git status', 'git branch -d feature', 'git push origin feature', 'git checkout main'];

    it.each(NON_RISKY)('%s keeps input riskLevel and gets zero inserted steps', (command) => {
      for (const level of ['safe', 'caution'] as RiskLevel[]) {
        const input = result(mode, [step(command, level)]);
        const out = validateSafety(input);
        expect(out.recoverySteps).toEqual(input.recoverySteps);
      }
    });
  });

  describe('16.13 complete window with non-empty warning', () => {
    it.each(RISKY_CASES)('$command keeps level, input warning, specific text, and label once', ({ command, level, safeguards, warnings }) => {
      for (const inputLevel of ['safe', 'caution', 'destructive'] as RiskLevel[]) {
        const input = result(mode, [
          ...safeguards.map((c) => step(c)),
          step(command, inputLevel, { warningMessage: INPUT_WARNING }),
        ]);
        const out = validateSafety(input);
        expect(out.recoverySteps).toHaveLength(safeguards.length + 1);
        const risky = riskyOutput(out, command);
        const expectedLevel = inputLevel === 'destructive' ? 'destructive' : level;
        expect(risky.riskLevel).toBe(expectedLevel);
        const warning = risky.warningMessage ?? '';
        expect(warning.startsWith(INPUT_WARNING)).toBe(true);
        for (const text of warnings) expect(warning).toContain(text);
        expect(countOccurrences(warning, RESIDUAL_RISK_LABEL)).toBe(1);
      }
    });

    it('an input warning already containing the label keeps it exactly once', () => {
      const command = 'git reset --hard HEAD~1';
      const inputWarning = `${INPUT_WARNING} ${RESIDUAL_RISK_LABEL}.`;
      const out = validateSafety(result(mode, [step(command, 'destructive', { warningMessage: inputWarning })]));
      const warning = riskyOutput(out, command).warningMessage ?? '';
      expect(warning.startsWith(inputWarning)).toBe(true);
      expect(countOccurrences(warning, RESIDUAL_RISK_LABEL)).toBe(1);
    });
  });

  describe('11.7 generic destructive warning', () => {
    it('unclassified destructive step with no warning gets the generic warning', () => {
      const out = validateSafety(result(mode, [step('git rebase -i HEAD~3', 'destructive')]));
      expect(out.recoverySteps[0].warningMessage).toBe(GENERIC_DESTRUCTIVE_WARNING);
      expect(out.recoverySteps[0].riskLevel).toBe('destructive');
    });

    it('unclassified destructive step with an empty warning gets the generic warning', () => {
      const out = validateSafety(result(mode, [step('git rebase -i HEAD~3', 'destructive', { warningMessage: '' })]));
      expect(out.recoverySteps[0].warningMessage).toBe(GENERIC_DESTRUCTIVE_WARNING);
    });

    it('unclassified destructive step with a warning keeps it unchanged', () => {
      const out = validateSafety(
        result(mode, [step('git rebase -i HEAD~3', 'destructive', { warningMessage: INPUT_WARNING })]),
      );
      expect(out.recoverySteps[0].warningMessage).toBe(INPUT_WARNING);
    });

    it('unclassified caution step without a warning gets no warning', () => {
      const out = validateSafety(result(mode, [step('git rebase --skip', 'caution')]));
      expect(out.recoverySteps[0]).not.toHaveProperty('warningMessage');
    });
  });

  describe('11.11 and 11.12 renumbering and backupPrerequisite', () => {
    it('renumbers steps 1..n after insertion and sets backupPrerequisite', () => {
      const out = validateSafety(
        result(mode, [
          step('git log --oneline -n 5'),
          step('git reset --hard HEAD~1'),
          step('git branch -D feature'),
          step('git status', 'safe', { backupPrerequisite: 'keep me' }),
        ]),
      );
      expect(out.recoverySteps.map((s) => s.stepNumber)).toEqual(out.recoverySteps.map((_, i) => i + 1));
      expect(riskyOutput(out, 'git reset --hard HEAD~1').backupPrerequisite).toBe('git status then git stash push -u');
      expect(riskyOutput(out, 'git branch -D feature').backupPrerequisite).toBe(
        'git log --oneline feature then git branch --no-merged',
      );
      expect(out.recoverySteps[out.recoverySteps.length - 1].backupPrerequisite).toBe('keep me');
    });

    it('overwrites an input backupPrerequisite on a Risky_Step even with a complete window', () => {
      const out = validateSafety(
        result(mode, [
          step('git fetch origin'),
          step('git log --oneline HEAD..origin/feature'),
          step('git push -f origin feature', 'destructive', { backupPrerequisite: 'something else' }),
        ]),
      );
      expect(out.recoverySteps).toHaveLength(3);
      expect(out.recoverySteps[2].backupPrerequisite).toBe(
        'git fetch origin then git log --oneline HEAD..origin/feature',
      );
    });

    it('inserted safeguard steps are safe and carry no warning or backupPrerequisite', () => {
      const out = validateSafety(result(mode, [step('git reset --hard HEAD~1')]));
      for (const s of out.recoverySteps.slice(0, 2)) {
        expect(s.riskLevel).toBe('safe');
        expect(s).not.toHaveProperty('warningMessage');
        expect(s).not.toHaveProperty('backupPrerequisite');
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.explanation.length).toBeGreaterThan(0);
      }
    });

    it('preserves analysisMode', () => {
      const out = validateSafety(result(mode, [step('git reset --hard HEAD~1')]));
      expect(out.analysisMode).toBe(mode);
    });
  });

  describe('11.13 multiple Risky_Commands in one step', () => {
    const command = 'git reset --hard && git clean -fdx';

    it('concatenates safeguard sets in order of appearance', () => {
      const out = validateSafety(result(mode, [step(command)]));
      expect(out.recoverySteps.map((s) => s.command)).toEqual([
        'git status',
        'git stash push -u',
        'git clean -ndx',
        command,
      ]);
      const risky = riskyOutput(out, command);
      expect(risky.riskLevel).toBe('destructive');
      expect(risky.backupPrerequisite).toBe('git status then git stash push -u then git clean -ndx');
      const warning = risky.warningMessage ?? '';
      for (const text of [RESET_UNCOMMITTED, BACKUP_BRANCH_LIMIT, CLEAN_PERMANENT, CLEAN_X]) {
        expect(warning).toContain(text);
      }
      expect(countOccurrences(warning, RESIDUAL_RISK_LABEL)).toBe(1);
    });

    it('uses the most severe level across lease and force-delete', () => {
      const multi = 'git push --force-with-lease origin feature; git branch -D feature';
      const out = validateSafety(result(mode, [step(multi)]));
      expect(riskyOutput(out, multi).riskLevel).toBe('destructive');
      expect(out.recoverySteps.map((s) => s.command)).toEqual([
        'git fetch origin',
        'git log --oneline HEAD..origin/feature',
        'git log --oneline feature',
        'git branch --no-merged',
        multi,
      ]);
    });

    it('inserts only the missing tail of the concatenated set', () => {
      const out = validateSafety(result(mode, [step('git status'), step('git stash push -u'), step(command)]));
      expect(out.recoverySteps.map((s) => s.command)).toEqual([
        'git status',
        'git stash push -u',
        'git clean -ndx',
        command,
      ]);
    });
  });
});
