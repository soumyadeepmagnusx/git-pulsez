// Feature: gitpulse-recovery-assistant, Property 5: Playbook content per incident type
/**
 * For any text classified as type T, the Recovery_Step commands contain the
 * commands required for T in the required order, and the summary contains the
 * type's required explanation. Checked on both the Fallback_Engine output and
 * the Safety_Validator output (playbooks contain no Risky_Commands, so no
 * Safeguard_Steps are inserted).
 *
 * **Validates: Requirements 3.2, 3.3, 4.3, 4.4, 5.2, 5.3, 6.2, 7.2**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import type { AnalysisResult, RecoveryStep, SupportedIncidentType } from '../../src/shared/analysisContract';
import { arbIncidentText, arbPlainLanguageText } from '../arbitraries';

/** Index of the first step whose command satisfies `pred`, or -1. */
function idx(steps: readonly RecoveryStep[], pred: (cmd: string, step: RecoveryStep) => boolean, from = 0): number {
  for (let i = from; i < steps.length; i++) if (pred(steps[i].command, steps[i])) return i;
  return -1;
}

/** Splits a command into its shell segments (enough for playbook commands). */
function segments(cmd: string): string[] {
  return cmd.split(/&&|\|\||;|\||\n/).map((s) => s.trim());
}

const has = (re: RegExp) => (cmd: string) => segments(cmd).some((s) => re.test(s));

/** A step that changes the checked-out branch (not creating one). */
const changesBranch = (cmd: string) =>
  segments(cmd).some(
    (s) => (/^git switch\b/.test(s) && !/^git switch (-c|--create|-C)\b/.test(s)) || (/^git checkout\b/.test(s) && !/^git checkout -b\b/.test(s)),
  );

/** Asserts the ordered required content for `type` on `result`. */
function checkPlaybook(type: SupportedIncidentType, result: AnalysisResult): void {
  const s = result.recoverySteps;
  const text = (st: RecoveryStep) => `${st.title} ${st.explanation}`;

  switch (type) {
    case 'rejected_push': {
      const status = idx(s, has(/^git status\b/));
      const fetch = idx(s, has(/^git fetch\b/), status + 1);
      const integrate = idx(s, has(/^git (pull --rebase|merge)\b/), fetch + 1);
      const push = idx(s, has(/^git push\b/), integrate + 1);
      expect(status).toBeGreaterThanOrEqual(0);
      expect(fetch).toBeGreaterThan(status);
      expect(integrate).toBeGreaterThan(fetch);
      expect(push).toBeGreaterThan(integrate);
      expect(result.summary).toMatch(/remote branch contains commits that your local branch does not have/);
      break;
    }
    case 'merge_conflict': {
      const status = idx(s, has(/^git status\b/));
      const markers = idx(s, (_c, st) => ['<<<<<<<', '=======', '>>>>>>>'].every((m) => text(st).includes(m)), status + 1);
      const add = idx(s, has(/^git add\b/), markers + 1);
      const commit = idx(s, has(/^git commit\b/), add + 1);
      const abort = idx(s, (c, st) => has(/^git merge --abort\b/)(c) && /pre-merge state/.test(text(st)));
      expect(status).toBeGreaterThanOrEqual(0);
      expect(markers).toBeGreaterThan(status);
      expect(add).toBeGreaterThan(markers);
      expect(commit).toBeGreaterThan(add);
      expect(abort).toBeGreaterThanOrEqual(0);
      break;
    }
    case 'detached_head': {
      const preserve = idx(s, has(/^git (switch (-c|--create)|branch) \S+/));
      const firstChange = idx(s, changesBranch);
      expect(preserve).toBeGreaterThanOrEqual(0);
      if (firstChange >= 0) expect(preserve).toBeLessThan(firstChange);
      expect(result.summary).toMatch(/HEAD points to a commit instead of a branch/);
      break;
    }
    case 'stuck_rebase': {
      const status = idx(s, has(/^git status\b/));
      const cont = idx(s, has(/^git rebase --continue\b/), status + 1);
      const abort = idx(s, (c, st) => has(/^git rebase --abort\b/)(c) && /pre-rebase state/.test(text(st)));
      expect(status).toBeGreaterThanOrEqual(0);
      expect(cont).toBeGreaterThan(status);
      expect(abort).toBeGreaterThanOrEqual(0);
      break;
    }
    case 'lost_commits': {
      const reflog = idx(s, has(/^git reflog\b/));
      const backup = idx(s, has(/^git branch \S+ \S+$/), reflog + 1);
      const log = idx(s, has(/^git log\b/), backup + 1);
      expect(reflog).toBeGreaterThanOrEqual(0);
      expect(backup).toBeGreaterThan(reflog);
      expect(log).toBeGreaterThan(backup);
      break;
    }
  }
}

function checkBoth(text: string, expectedType: SupportedIncidentType): void {
  const raw = analyzeFallback(text);
  expect(raw.incidentType).toBe(expectedType);
  checkPlaybook(expectedType, raw);

  // Playbooks contain no Risky_Commands, so validation inserts no steps.
  for (const step of raw.recoverySteps) expect(classifyCommand(step.command)).toEqual([]);
  const validated = validateSafety(raw);
  expect(validated.recoverySteps.map((st) => st.command)).toEqual(raw.recoverySteps.map((st) => st.command));
  checkPlaybook(expectedType, validated);
}

describe('Property 5: Playbook content per incident type', () => {
  it('terminal-output incidents yield the required playbook content (raw and validated)', () => {
    fc.assert(
      fc.property(arbIncidentText({ minTypes: 1 }), ({ text, includedTypes }) => {
        checkBoth(text, includedTypes[0]);
      }),
      { numRuns: 200 },
    );
  });

  it('plain-language incidents yield the required playbook content (raw and validated)', () => {
    fc.assert(
      fc.property(arbPlainLanguageText({ minTypes: 1 }), ({ text, includedTypes }) => {
        checkBoth(text, includedTypes[0]);
      }),
      { numRuns: 100 },
    );
  });
});
