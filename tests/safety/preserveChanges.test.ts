import { describe, expect, it } from 'vitest';
import type { AnalysisMode, AnalysisResult, RecoveryStep } from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { matchesPreserveChanges } from '../../src/lib/safety/safeguards';
import { parseGitInvocations } from '../../src/lib/safety/gitCommandParser';

// Requirements: 12.6, 12.7, 12.13, 12.14, 12.15, 11.8, 11.9

function step(command: string, riskLevel: RecoveryStep['riskLevel'] = 'safe'): Omit<RecoveryStep, 'stepNumber'> {
  return { title: `Run ${command}`, explanation: `Explanation for ${command}`, command, riskLevel };
}

function makeResult(commands: string[], mode: AnalysisMode = 'fallback_demo'): AnalysisResult {
  return {
    incidentType: 'lost_commits',
    title: 'Test incident',
    confidence: 'medium',
    severity: 'high',
    analysisMode: mode,
    summary: 'Test summary',
    detectedEvidence: [],
    assumptions: [],
    recoverySteps: commands.map((c, i) => ({ ...step(c), stepNumber: i + 1 })),
  };
}

/** Commands of steps inserted by the validator (steps not present in the input). */
function insertedCommands(input: AnalysisResult, output: AnalysisResult): string[] {
  const originals = input.recoverySteps.map((s) => s.title);
  return output.recoverySteps.filter((s) => !originals.includes(s.title)).map((s) => s.command);
}

const RISKY_COMMANDS = ['git reset --hard HEAD~1', 'git checkout -f main'];

const ACCEPTED = [
  'git stash push -u',
  'git stash push --include-untracked',
  'git stash push -a',
  'git stash push --all',
  'git stash push -um "wip"',
  'git stash push -ku',
  'git stash push -u -m "wip"',
  'git stash -u',
  'git stash --include-untracked',
  'git stash -a',
  'git stash --all',
  'git stash -um "wip"',
];

const REJECTED = [
  'git commit -m "wip"',
  'git commit -am "wip"',
  'git stash',
  'git stash push',
  'git stash push -m "wip"',
  'git stash push -u --no-include-untracked',
  'git stash push -u -- src/',
  'git stash push -p -u',
  'git stash save -u',
];

function matcher(command: string): boolean {
  return parseGitInvocations(command).some(matchesPreserveChanges);
}

describe('preserve_changes matcher', () => {
  it.each(ACCEPTED)('accepts %s', (command) => {
    expect(matcher(command)).toBe(true);
  });

  it.each(REJECTED)('rejects %s', (command) => {
    expect(matcher(command)).toBe(false);
  });
});

describe.each(['fallback_demo', 'bedrock_ai'] as const)('Safety_Validator window (%s)', (mode) => {
  describe.each(RISKY_COMMANDS)('before %s', (risky) => {
    it.each(ACCEPTED)('window with git status then %s inserts nothing', (stash) => {
      const input = makeResult(['git status', stash, risky], mode);
      const output = validateSafety(input);
      expect(insertedCommands(input, output)).toEqual([]);
      expect(output.recoverySteps.map((s) => s.command)).toEqual(['git status', stash, risky]);
      expect(output.analysisMode).toBe(mode);
    });

    it.each(REJECTED)('window with git status then %s inserts git stash push -u', (cmd) => {
      const input = makeResult(['git status', cmd, risky], mode);
      const output = validateSafety(input);
      expect(insertedCommands(input, output)).toEqual(['git stash push -u']);
      // Inserted immediately before the Risky_Step.
      expect(output.recoverySteps.map((s) => s.command)).toEqual(['git status', cmd, 'git stash push -u', risky]);
      const inserted = output.recoverySteps[2];
      expect(inserted.riskLevel).toBe('safe');
      expect(inserted.warningMessage).toBeUndefined();
      expect(inserted.backupPrerequisite).toBeUndefined();
      expect(output.recoverySteps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4]);
    });

    it('window with only git commit -am "wip" receives git status and git stash push -u', () => {
      const input = makeResult(['git commit -am "wip"', risky], mode);
      const output = validateSafety(input);
      expect(output.recoverySteps.map((s) => s.command)).toEqual([
        'git commit -am "wip"',
        'git status',
        'git stash push -u',
        risky,
      ]);
    });
  });
});
