import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_INCIDENT_TYPES,
  isAnalysisResult,
  type AnalysisResult,
  type IncidentType,
} from '../../src/shared/analysisContract';
import { alsoMatchesAssumption, analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { PRIORITY, detectIncidentTypes } from '../../src/lib/fallback/patterns';
import {
  ASSUME_BRANCH_PLACEHOLDER,
  ASSUME_REMOTE_ORIGIN,
  ASSUME_UNCOMMITTED_UNKNOWN,
  PLAYBOOKS,
  UNKNOWN_ASSUMPTION,
} from '../../src/lib/fallback/playbooks';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { SAMPLE_INCIDENTS } from '../../src/data/sampleIncidents';

function commands(r: AnalysisResult): string[] {
  return r.recoverySteps.map((s) => s.command);
}

function indexOfCommand(r: AnalysisResult, predicate: (c: string) => boolean): number {
  return r.recoverySteps.findIndex((s) => predicate(s.command));
}

function sample(id: IncidentType): string {
  const s = SAMPLE_INCIDENTS.find((x) => x.id === id);
  if (!s) throw new Error(`missing sample ${id}`);
  return s.incidentText;
}

describe('Sample_Incidents (Req 2.5)', () => {
  it('has exactly one sample per supported type', () => {
    expect(SAMPLE_INCIDENTS).toHaveLength(5);
    expect(new Set(SAMPLE_INCIDENTS.map((s) => s.id))).toEqual(new Set(SUPPORTED_INCIDENT_TYPES));
  });

  for (const s of SAMPLE_INCIDENTS) {
    it(`${s.id} sample yields its own type and matches only its own triggers`, () => {
      expect(detectIncidentTypes(s.incidentText)).toEqual([s.id]);
      const r = analyzeFallback(s.incidentText);
      expect(r.incidentType).toBe(s.id);
      expect(r.analysisMode).toBe('fallback_demo');
      expect(isAnalysisResult(r)).toBe(true);
      expect(r.confidence).toBe('high');
    });
  }
});

describe('playbooks contain no Risky_Commands', () => {
  for (const [type, playbook] of Object.entries(PLAYBOOKS)) {
    it(`${type} playbook commands classify as not risky`, () => {
      for (const step of playbook.steps) {
        expect(classifyCommand(step.command), step.command).toEqual([]);
      }
    });
  }
});

describe('rejected_push (Req 3.1–3.3, 10.2)', () => {
  it.each([
    ' ! [rejected]        main -> main (non-fast-forward)',
    ' ! [rejected]        main -> main (fetch first)',
    ' ! [rejected] main -> main\nhint: Updates were rejected because the tip is behind',
  ])('detects %j', (text) => {
    expect(analyzeFallback(text).incidentType).toBe('rejected_push');
  });

  it('does not match [rejected] without a reason', () => {
    expect(analyzeFallback(' ! [rejected] main -> main').incidentType).toBe('unknown');
  });

  it('orders status, fetch, integrate, push and explains the missing commits', () => {
    const r = analyzeFallback(sample('rejected_push'));
    expect(commands(r)).toEqual([
      'git status',
      'git fetch origin',
      'git log --oneline HEAD..origin/<branch>',
      'git pull --rebase origin <branch>',
      'git push origin <branch>',
    ]);
    const integrate = r.recoverySteps[3];
    expect(integrate.riskLevel).toBe('caution');
    expect(integrate.explanation).toContain('git merge origin/<branch>');
    expect(r.summary).toContain('remote branch contains commits that your local branch does not have');
  });

  it('records placeholder assumptions for remote, branch, and uncommitted changes', () => {
    const r = analyzeFallback(sample('rejected_push'));
    expect(r.assumptions).toEqual(
      expect.arrayContaining([ASSUME_REMOTE_ORIGIN, ASSUME_BRANCH_PLACEHOLDER, ASSUME_UNCOMMITTED_UNKNOWN]),
    );
  });
});

describe('merge_conflict (Req 4.1–4.4)', () => {
  it.each(['CONFLICT (content): x', 'Automatic merge failed', 'please fix conflicts and then commit the result'])(
    'detects %j',
    (text) => {
      expect(analyzeFallback(text).incidentType).toBe('merge_conflict');
    },
  );

  it('extracts each conflicted path and line as evidence', () => {
    const r = analyzeFallback(sample('merge_conflict'));
    expect(r.detectedEvidence).toEqual(
      expect.arrayContaining([
        'CONFLICT (content): Merge conflict in src/auth/session.ts',
        'src/auth/session.ts',
        'CONFLICT (content): Merge conflict in src/config.ts',
        'src/config.ts',
        'Automatic merge failed; fix conflicts and then commit the result.',
      ]),
    );
  });

  it('lists status, marker explanation, add, commit, and abort in order', () => {
    const r = analyzeFallback(sample('merge_conflict'));
    expect(commands(r)).toEqual(['git status', 'git diff', 'git add <file>', 'git commit', 'git merge --abort']);
    const markers = r.recoverySteps[1].explanation;
    expect(markers).toContain('<<<<<<<');
    expect(markers).toContain('=======');
    expect(markers).toContain('>>>>>>>');
    expect(r.recoverySteps[4].explanation).toContain('pre-merge state');
  });
});

describe('detached_head (Req 5.1–5.3)', () => {
  it.each(["You are in 'detached HEAD' state.", 'HEAD detached at 3f9c2a1', 'HEAD detached from 3f9c2a1'])(
    'detects %j',
    (text) => {
      expect(analyzeFallback(text).incidentType).toBe('detached_head');
    },
  );

  it('creates a branch before any branch-changing step', () => {
    const r = analyzeFallback(sample('detached_head'));
    const create = indexOfCommand(r, (c) => c.startsWith('git switch -c'));
    const change = indexOfCommand(r, (c) => /^git switch (?!-c)/.test(c));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(change).toBeGreaterThan(create);
    expect(r.summary).toContain('HEAD points to a commit instead of a branch');
  });
});

describe('stuck_rebase (Req 6.1–6.3)', () => {
  it.each([
    'rebase in progress; onto abc1234',
    'interactive rebase in progress',
    'run "git rebase --continue"',
    'error: could not apply 5d6e7f8... msg',
  ])('detects %j', (text) => {
    expect(analyzeFallback(text).incidentType).toBe('stuck_rebase');
  });

  it('includes status, continue, and abort to the pre-rebase state', () => {
    const r = analyzeFallback(sample('stuck_rebase'));
    const cmds = commands(r);
    expect(cmds[0]).toBe('git status');
    const cont = cmds.findIndex((c) => c.includes('git rebase --continue'));
    const abort = cmds.indexOf('git rebase --abort');
    expect(cont).toBeGreaterThan(0);
    expect(abort).toBeGreaterThan(cont);
    expect(r.recoverySteps[abort].explanation).toContain('pre-rebase state');
  });

  it('extracts the onto hash as evidence', () => {
    const r = analyzeFallback(sample('stuck_rebase'));
    expect(r.detectedEvidence).toContain('9e4b7c2');
    expect(r.detectedEvidence).toContain('onto 9e4b7c2');
  });
});

describe('lost_commits (Req 7.1–7.3)', () => {
  it.each([
    'abc1234 HEAD@{0}: reset: moving to HEAD~1',
    'I ran git reset --hard by mistake',
    'I LOST MY COMMITS yesterday',
    'my commits disappeared',
    'how do I undo a reset',
  ])('detects %j', (text) => {
    expect(analyzeFallback(text).incidentType).toBe('lost_commits');
  });

  it('lists reflog, backup branch, and log verification in order', () => {
    const r = analyzeFallback(sample('lost_commits'));
    expect(commands(r)).toEqual(['git reflog', 'git branch <backup-name> <commit>', 'git log --oneline <backup-name>']);
    expect(r.severity).toBe('high');
  });

  it('extracts every reflog line as evidence', () => {
    const r = analyzeFallback(sample('lost_commits'));
    expect(r.detectedEvidence).toEqual(
      expect.arrayContaining([
        '4c5d6e7 HEAD@{0}: reset: moving to HEAD~3',
        'b8e9f01 HEAD@{1}: commit: Add payment webhook handler',
        'a7c3d22 HEAD@{2}: commit: Validate webhook signatures',
        'e1f2a3b HEAD@{3}: commit: Add payment client',
        '4c5d6e7 HEAD@{4}: commit: Update README',
      ]),
    );
  });
});

describe('unknown (Req 8.1–8.3)', () => {
  it('returns low confidence, safe-only inspection steps, and the could-not-match assumption', () => {
    const r = analyzeFallback('My laptop fan is loud when I compile.');
    expect(r.incidentType).toBe('unknown');
    expect(r.confidence).toBe('low');
    expect(r.severity).toBe('low');
    expect(r.recoverySteps.every((s) => s.riskLevel === 'safe')).toBe(true);
    expect(commands(r)).toEqual(['git status', 'git log --oneline -n 10', 'git reflog -n 10']);
    expect(r.assumptions).toContain(UNKNOWN_ASSUMPTION);
    expect(r.detectedEvidence).toEqual([]);
    expect(isAnalysisResult(r)).toBe(true);
  });
});

describe('priority resolution (Req 8.4)', () => {
  it('uses the documented priority order', () => {
    expect(PRIORITY).toEqual(['stuck_rebase', 'merge_conflict', 'lost_commits', 'detached_head', 'rejected_push']);
  });

  it('chooses the highest-priority type and records the others', () => {
    const text = [
      ' ! [rejected] main -> main (non-fast-forward)',
      'HEAD detached at 3f9c2a1',
      'CONFLICT (content): Merge conflict in a.ts',
      'interactive rebase in progress; onto 9e4b7c2',
    ].join('\n');
    const r = analyzeFallback(text);
    expect(r.incidentType).toBe('stuck_rebase');
    expect(r.assumptions).toEqual(
      expect.arrayContaining([
        alsoMatchesAssumption('merge_conflict', 'stuck_rebase'),
        alsoMatchesAssumption('detached_head', 'stuck_rebase'),
        alsoMatchesAssumption('rejected_push', 'stuck_rebase'),
      ]),
    );
    expect(r.assumptions.some((a) => a.includes('also matches lost_commits'))).toBe(false);
  });

  it('adds no "also matches" assumption for a single match', () => {
    const r = analyzeFallback(sample('merge_conflict'));
    expect(r.assumptions.some((a) => a.includes('also matches'))).toBe(false);
  });
});

describe('evidence and confidence (Req 10.1, 10.5)', () => {
  it('every evidence entry is a substring of the input for all samples', () => {
    for (const s of SAMPLE_INCIDENTS) {
      for (const e of analyzeFallback(s.incidentText).detectedEvidence) {
        expect(s.incidentText).toContain(e);
      }
    }
  });

  it('caps plain-language descriptions at medium confidence', () => {
    const r = analyzeFallback('I think I lost my commits after a reset yesterday. My commits disappeared.');
    expect(r.incidentType).toBe('lost_commits');
    expect(r.detectedEvidence.length).toBeGreaterThanOrEqual(1);
    expect(r.confidence).toBe('medium');
  });

  it('caps terminal output with fewer than 2 evidence entries at medium', () => {
    const r = analyzeFallback('HEAD detached at 3f9c2a1');
    expect(r.detectedEvidence).toHaveLength(1);
    expect(r.confidence).toBe('medium');
  });

  it('numbers steps 1..n and passes the contract for every type', () => {
    for (const s of SAMPLE_INCIDENTS) {
      const r = analyzeFallback(s.incidentText);
      expect(r.recoverySteps.map((x) => x.stepNumber)).toEqual(r.recoverySteps.map((_, i) => i + 1));
      expect(isAnalysisResult(r)).toBe(true);
    }
  });
});

describe('performance (Req 21.5)', () => {
  it('analyzes a 20,000-character worst-case input in under 500 ms', () => {
    const chunk =
      'CONFLICT (content): Merge conflict in src/f.ts\n' +
      'abcdef1 HEAD@{1}: commit: x\n' +
      'interactive rebase in progress; onto 1234567\n' +
      ' ! [rejected] main (fetch first) HEAD detached at aaaaaaa lost my commit\n' +
      '0123456789abcdef'.repeat(4) +
      '\n';
    let text = '';
    while (text.length + chunk.length <= 20_000) text += chunk;
    text = (text + 'a'.repeat(20_000)).slice(0, 20_000);
    expect(text.length).toBe(20_000);

    const start = performance.now();
    const r = analyzeFallback(text);
    const elapsed = performance.now() - start;
    expect(isAnalysisResult(r)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
