/**
 * Requirement 16 risky-category tests for the Safety_Validator.
 * Every case runs for both Analysis_Modes (Req 16.12).
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.12, 16.14, 16.15,
 * 12.2, 12.3, 12.5, 12.9, 12.10, 12.11, 13.2, 13.3, 13.5, 14.3, 14.4, 14.5,
 * 14.6, 14.11, 15.2, 15.3, 15.4
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
  CLEAN_BIG_X,
  CLEAN_PERMANENT,
  CLEAN_X,
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

function resultWith(mode: AnalysisMode, command: string): AnalysisResult {
  return {
    incidentType: 'unknown',
    title: 'Test incident',
    confidence: 'low',
    severity: 'low',
    analysisMode: mode,
    summary: 'Test summary',
    detectedEvidence: [],
    assumptions: [],
    recoverySteps: [
      {
        stepNumber: 1,
        title: 'Risky step',
        explanation: 'Runs the risky command.',
        command,
        riskLevel: 'safe',
      },
    ],
  };
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

interface CategoryCase {
  command: string;
  level: RiskLevel;
  warnings: string[];
  absentWarnings?: string[];
  safeguards: string[];
}

const CASES: CategoryCase[] = [
  // 16.1 / 16.14
  {
    command: 'git reset --hard HEAD~1',
    level: 'destructive',
    warnings: [RESET_UNCOMMITTED, BACKUP_BRANCH_LIMIT, STASH_NOT_GUARANTEE, STASH_IGNORED, UNPROTECTED_DATA],
    safeguards: ['git status', 'git stash push -u'],
  },
  // 16.2
  {
    command: 'git clean -f',
    level: 'destructive',
    warnings: [CLEAN_PERMANENT],
    absentWarnings: [CLEAN_X, CLEAN_BIG_X],
    safeguards: ['git clean -n'],
  },
  {
    command: 'git clean -fd',
    level: 'destructive',
    warnings: [CLEAN_PERMANENT],
    absentWarnings: [CLEAN_X, CLEAN_BIG_X],
    safeguards: ['git clean -nd'],
  },
  {
    command: 'git clean -fx',
    level: 'destructive',
    warnings: [CLEAN_PERMANENT, CLEAN_X],
    absentWarnings: [CLEAN_BIG_X],
    safeguards: ['git clean -nx'],
  },
  {
    command: 'git clean -fdx',
    level: 'destructive',
    warnings: [CLEAN_PERMANENT, CLEAN_X],
    absentWarnings: [CLEAN_BIG_X],
    safeguards: ['git clean -ndx'],
  },
  // 16.3
  {
    command: 'git push --force origin feature',
    level: 'destructive',
    warnings: [PUSH_FORCE_OVERWRITE, PUSH_FORCE_LEASE_ADVICE],
    safeguards: ['git fetch origin', 'git log --oneline HEAD..origin/feature'],
  },
  {
    command: 'git push -f origin feature',
    level: 'destructive',
    warnings: [PUSH_FORCE_OVERWRITE, PUSH_FORCE_LEASE_ADVICE],
    safeguards: ['git fetch origin', 'git log --oneline HEAD..origin/feature'],
  },
  // 16.4 / 16.15
  {
    command: 'git push --force-with-lease origin feature',
    level: 'caution',
    warnings: [LEASE_LIMITS, leaseConditions('origin', 'feature')],
    absentWarnings: [PUSH_FORCE_OVERWRITE],
    safeguards: ['git fetch origin', 'git log --oneline HEAD..origin/feature'],
  },
  // 16.5 / 16.14
  {
    command: 'git checkout -f main',
    level: 'destructive',
    warnings: [CHECKOUT_FORCE, STASH_NOT_GUARANTEE, STASH_IGNORED, UNPROTECTED_DATA],
    safeguards: ['git status', 'git stash push -u'],
  },
  // 16.6
  {
    command: 'git branch -D feature',
    level: 'destructive',
    warnings: [BRANCH_REFLOG_LIMIT, branchTagBackup('feature')],
    safeguards: ['git log --oneline feature', 'git branch --no-merged'],
  },
];

describe.each(MODES)('Safety_Validator risky categories (analysisMode %s)', (mode) => {
  describe.each(CASES)('$command', ({ command, level, warnings, absentWarnings, safeguards }) => {
    const output = validateSafety(resultWith(mode, command));
    const steps = output.recoverySteps;
    const riskyStep = steps[steps.length - 1] as RecoveryStep;
    const warning = riskyStep.warningMessage ?? '';

    it('keeps the analysis mode', () => {
      expect(output.analysisMode).toBe(mode);
    });

    it('outputs the classified risk level', () => {
      expect(riskyStep.command).toBe(command);
      expect(riskyStep.riskLevel).toBe(level);
    });

    it('includes every command-specific warning text', () => {
      for (const text of warnings) {
        expect(warning).toContain(text);
      }
      for (const text of absentWarnings ?? []) {
        expect(warning).not.toContain(text);
      }
    });

    it('includes the Residual_Risk_Label exactly once', () => {
      expect(countOccurrences(warning, RESIDUAL_RISK_LABEL)).toBe(1);
    });

    it('inserts the safeguard steps in order immediately before the risky step', () => {
      expect(steps.map((s) => s.command)).toEqual([...safeguards, command]);
      for (const inserted of steps.slice(0, -1)) {
        expect(inserted.riskLevel).toBe('safe');
        expect(inserted.title).not.toBe('');
        expect(inserted.explanation).not.toBe('');
        expect(inserted.warningMessage).toBeUndefined();
        expect(inserted.backupPrerequisite).toBeUndefined();
      }
      expect(steps.map((s) => s.stepNumber)).toEqual(steps.map((_, i) => i + 1));
    });

    it('sets backupPrerequisite to the safeguard commands joined with " then "', () => {
      expect(riskyStep.backupPrerequisite).toBe(safeguards.join(' then '));
    });
  });

  // 16.14: inserted stash explanation states ignored files are not saved.
  it.each(['git reset --hard HEAD~1', 'git checkout -f main'])(
    'the inserted stash step for %s states ignored files are not saved',
    (command) => {
      const steps = validateSafety(resultWith(mode, command)).recoverySteps;
      const stash = steps.find((s) => s.command === 'git stash push -u');
      expect(stash).toBeDefined();
      expect(stash?.explanation).toContain('Ignored files are not saved.');
      expect(stash?.explanation).toContain('git stash pop');
    },
  );

  // 16.15: lease warning names the inspection commands, target branch, and team workflow.
  it('the lease warning contains the inspect, target-branch, and team-workflow conditions', () => {
    const steps = validateSafety(resultWith(mode, 'git push --force-with-lease origin feature')).recoverySteps;
    const warning = steps[steps.length - 1].warningMessage ?? '';
    expect(warning).toContain('git fetch origin and git log --oneline HEAD..origin/feature');
    expect(warning).toContain('confirming that feature is the intended target branch');
    expect(warning).toContain('your team workflow permits rewriting the branch');
  });
});
