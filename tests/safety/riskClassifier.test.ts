import { describe, expect, it } from 'vitest';
import { tokenizeCommand } from '../../src/lib/safety/shellTokenizer';
import { parseGitInvocations } from '../../src/lib/safety/gitCommandParser';
import {
  classifyCommand,
  extractBranchNames,
  extractPushTarget,
} from '../../src/lib/safety/riskClassifier';

function ops(command: string): Array<[string, string]> {
  return classifyCommand(command).map((r) => [r.operation, r.level]);
}

function firstInvocation(command: string) {
  const [inv] = parseGitInvocations(command);
  expect(inv).toBeDefined();
  return inv;
}

describe('shell tokenizer', () => {
  it('splits words on whitespace', () => {
    expect(tokenizeCommand('git  reset\t--hard')).toEqual([['git', 'reset', '--hard']]);
  });

  it('keeps double-quoted text as one word, including separators', () => {
    expect(tokenizeCommand('git commit -m "fix; --force && more"')).toEqual([
      ['git', 'commit', '-m', 'fix; --force && more'],
    ]);
  });

  it('keeps single-quoted text literally', () => {
    expect(tokenizeCommand(`git commit -m 'a "b" \\c'`)).toEqual([
      ['git', 'commit', '-m', 'a "b" \\c'],
    ]);
  });

  it('honors backslash escapes outside and inside double quotes', () => {
    expect(tokenizeCommand('git log a\\ b')).toEqual([['git', 'log', 'a b']]);
    expect(tokenizeCommand('git log "say \\"hi\\""')).toEqual([['git', 'log', 'say "hi"']]);
    expect(tokenizeCommand('git log a\\;b')).toEqual([['git', 'log', 'a;b']]);
  });

  it('yields an empty word for empty quotes', () => {
    expect(tokenizeCommand(`git commit -m ''`)).toEqual([['git', 'commit', '-m', '']]);
  });

  it.each([
    ['&&', 'git status && git log'],
    ['||', 'git status || git log'],
    [';', 'git status; git log'],
    ['|', 'git status | git log'],
    ['newline', 'git status\ngit log'],
  ])('splits segments on %s', (_label, command) => {
    expect(tokenizeCommand(command)).toEqual([
      ['git', 'status'],
      ['git', 'log'],
    ]);
  });

  it('omits empty segments', () => {
    expect(tokenizeCommand('git status;; && git log &&')).toEqual([
      ['git', 'status'],
      ['git', 'log'],
    ]);
  });

  it('puts the remainder after an unclosed quote into one word', () => {
    expect(tokenizeCommand('git commit -m "oops && git reset --hard')).toEqual([
      ['git', 'commit', '-m', 'oops && git reset --hard'],
    ]);
  });
});

describe('git command parser', () => {
  it('skips global options and expands short groups', () => {
    const inv = firstInvocation('git -C repo -c a=b --no-pager clean -fdx -- build/');
    expect(inv.subcommand).toBe('clean');
    expect(inv.shortFlags).toEqual(['f', 'd', 'x']);
    expect(inv.positionals).toEqual(['build/']);
    expect(inv.afterDoubleDash).toEqual(['build/']);
  });

  it('stores --name=value and keeps --force-with-lease distinct from --force', () => {
    const inv = firstInvocation('git push --force-with-lease=main origin main');
    expect(inv.longOpts.get('--force-with-lease')).toBe('main');
    expect(inv.longOpts.has('--force')).toBe(false);
    expect(inv.positionals).toEqual(['origin', 'main']);
  });

  it('lets a value-taking short option consume the next word', () => {
    const inv = firstInvocation('git commit -m "--force"');
    expect(inv.longOpts.size).toBe(0);
    expect(inv.positionals).toEqual([]);
    expect(inv.shortFlags).toEqual(['m']);
  });

  it('keeps short flags case-sensitive', () => {
    expect(firstInvocation('git branch -D x').shortFlags).toEqual(['D']);
    expect(firstInvocation('git branch -d x').shortFlags).toEqual(['d']);
  });

  it('ignores non-git segments', () => {
    expect(parseGitInvocations('echo git reset --hard && ls')).toEqual([]);
  });
});

describe('classifyCommand edge examples', () => {
  it('treats --force-with-lease=<ref> alone as caution', () => {
    expect(ops('git push --force-with-lease=main origin main')).toEqual([
      ['push_force_with_lease', 'caution'],
    ]);
  });

  it('treats --force-with-lease combined with -f as destructive push_force', () => {
    expect(ops('git push origin main --force-with-lease -f')).toEqual([['push_force', 'destructive']]);
  });

  it('treats -d -f and --delete --force as destructive branch deletion', () => {
    expect(ops('git branch -d -f old')).toEqual([['branch_force_delete', 'destructive']]);
    expect(ops('git branch --delete --force old')).toEqual([['branch_force_delete', 'destructive']]);
    expect(ops('git branch -df old')).toEqual([['branch_force_delete', 'destructive']]);
  });

  it('treats git clean -nf as destructive (never downgrades on -n)', () => {
    expect(ops('git clean -nf')).toEqual([['clean_force', 'destructive']]);
  });

  it('classifies reset --hard after global options', () => {
    expect(ops('git -C repo reset --hard')).toEqual([['reset_hard', 'destructive']]);
  });

  it('returns every risky command in order of appearance', () => {
    const result = classifyCommand('git reset --hard && git clean -fdx');
    expect(result.map((r) => r.operation)).toEqual(['reset_hard', 'clean_force']);
    expect(result[1].clean).toEqual({ d: true, x: true, X: false, pathspecs: [] });
  });

  it('does not treat an option-looking commit message as an option', () => {
    expect(classifyCommand('git commit -m "--force"')).toEqual([]);
  });

  it.each([
    'git clean -n',
    'git clean -nd',
    'git clean --dry-run -d',
    'git branch -d feature',
    'git branch --delete feature',
    'git push origin feature',
    'git checkout main',
    'git status',
    'git reset --soft HEAD~1',
  ])('does not classify %s as risky', (command) => {
    expect(classifyCommand(command)).toEqual([]);
  });

  it.each([
    ['git checkout -f main', 'checkout_force'],
    ['git checkout --force main', 'checkout_force'],
    ['git push --force origin feature', 'push_force'],
    ['git push -f origin feature', 'push_force'],
    ['git clean --force -d', 'clean_force'],
  ])('classifies %s as destructive %s', (command, operation) => {
    expect(ops(command)).toEqual([[operation, 'destructive']]);
  });

  it('records -X separately from -x for clean', () => {
    const [risky] = classifyCommand('git clean -fX -- dist/ out/');
    expect(risky.clean).toEqual({ d: false, x: false, X: true, pathspecs: ['dist/', 'out/'] });
  });
});

describe('push target extraction', () => {
  const target = (command: string) => extractPushTarget(firstInvocation(command));

  it('uses the named remote and branch', () => {
    expect(target('git push --force upstream feature')).toEqual({
      remote: 'upstream',
      branch: 'feature',
      remoteNamed: true,
      branchNamed: true,
    });
  });

  it('defaults to origin and <branch> when both are omitted', () => {
    expect(target('git push --force')).toEqual({
      remote: 'origin',
      branch: '<branch>',
      remoteNamed: false,
      branchNamed: false,
    });
  });

  it('uses <branch> when only the remote is named', () => {
    expect(target('git push --force-with-lease upstream')).toEqual({
      remote: 'upstream',
      branch: '<branch>',
      remoteNamed: true,
      branchNamed: false,
    });
  });

  it('strips a leading + and refs/heads/ prefix', () => {
    expect(target('git push origin +refs/heads/x').branch).toBe('x');
  });

  it('uses the destination of a src:dst refspec', () => {
    expect(target('git push -f origin local:remote-branch').branch).toBe('remote-branch');
    expect(target('git push -f origin +HEAD:refs/heads/main').branch).toBe('main');
  });

  it('attaches the push target to classified push commands', () => {
    const [risky] = classifyCommand('git push --force-with-lease origin feature');
    expect(risky.push).toMatchObject({ remote: 'origin', branch: 'feature' });
  });
});

describe('branch name extraction', () => {
  it('returns every deleted branch name', () => {
    expect(extractBranchNames(firstInvocation('git branch -D feature old-fix'))).toEqual([
      'feature',
      'old-fix',
    ]);
  });

  it('returns the <branch> placeholder when no name is given', () => {
    expect(extractBranchNames(firstInvocation('git branch -D'))).toEqual(['<branch>']);
  });

  it('attaches branch names to classified branch deletions', () => {
    const [risky] = classifyCommand('git branch --delete --force old');
    expect(risky.branchNames).toEqual(['old']);
  });
});
