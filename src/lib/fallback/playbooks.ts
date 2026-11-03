/**
 * Fallback_Engine playbooks (design: "Fallback_Engine" → "Playbooks").
 *
 * One ordered list of Recovery_Step templates per Incident_Type, plus the
 * title, beginner-friendly summary, severity, and placeholder assumptions.
 * Step numbers are assigned by the Fallback_Engine. No playbook command is a
 * Risky_Command; risky commands can only arrive from Bedrock, and the
 * Safety_Validator handles them.
 */
import type { IncidentType, RecoveryStep, Severity } from '../../shared/analysisContract';

export type PlaybookStep = Omit<RecoveryStep, 'stepNumber'>;

export interface Playbook {
  title: string;
  summary: string;
  severity: Severity;
  /** Inferences the Incident_Text does not directly show (Req 10.2). */
  assumptions: readonly string[];
  steps: readonly PlaybookStep[];
}

/** Exact assumption text for unmatched input (Req 8.3). */
export const UNKNOWN_ASSUMPTION = 'GitPulse could not match the incident text to a known incident type.';

export const ASSUME_REMOTE_ORIGIN = 'The remote is assumed to be `origin` because the output does not name it.';
export const ASSUME_BRANCH_PLACEHOLDER =
  'The branch name is not shown, so `<branch>` is a placeholder. Replace it with your branch name.';
export const ASSUME_UNCOMMITTED_UNKNOWN = 'GitPulse cannot see whether you have uncommitted changes.';

export const PLAYBOOKS: Readonly<Record<IncidentType, Playbook>> = {
  rejected_push: {
    title: 'Push rejected: the remote branch has new commits',
    summary:
      'Git refused your push because the remote branch contains commits that your local branch does not have yet. ' +
      'Someone (or you, from another machine) pushed to the same branch. Download those commits and combine them ' +
      'with your work before pushing again, instead of overwriting them.',
    severity: 'medium',
    assumptions: [ASSUME_REMOTE_ORIGIN, ASSUME_BRANCH_PLACEHOLDER, ASSUME_UNCOMMITTED_UNKNOWN],
    steps: [
      {
        title: 'Check your local state',
        explanation:
          'Shows your current branch and any uncommitted changes. Commit or stash unfinished work before integrating remote changes.',
        command: 'git status',
        riskLevel: 'safe',
      },
      {
        title: 'Download the remote changes',
        explanation:
          'Fetches the new commits from the remote without changing your local branch or your files.',
        command: 'git fetch origin',
        riskLevel: 'safe',
      },
      {
        title: 'See which commits you are missing',
        explanation:
          'Lists the commits that exist on the remote branch but not on your local branch. These are the commits your push would have overwritten.',
        command: 'git log --oneline HEAD..origin/<branch>',
        riskLevel: 'safe',
      },
      {
        title: 'Integrate the remote changes',
        explanation:
          'Replays your local commits on top of the remote commits. If conflicts appear, resolve them and run git rebase --continue. ' +
          'If you prefer not to rewrite your local commits, run git merge origin/<branch> instead to create a merge commit.',
        command: 'git pull --rebase origin <branch>',
        riskLevel: 'caution',
      },
      {
        title: 'Push again',
        explanation:
          'Your branch now contains the remote commits plus your own, so a normal push (without force) can succeed.',
        command: 'git push origin <branch>',
        riskLevel: 'safe',
      },
    ],
  },

  merge_conflict: {
    title: 'Merge conflict: Git needs you to choose between changes',
    summary:
      'Git tried to combine two branches but found places where both sides changed the same lines. ' +
      'Git paused the merge and marked those places in the affected files so you can decide what the final content should be.',
    severity: 'medium',
    assumptions: [ASSUME_UNCOMMITTED_UNKNOWN],
    steps: [
      {
        title: 'List the conflicted files',
        explanation:
          'Shows which files are "both modified" and still need to be resolved before the merge can finish.',
        command: 'git status',
        riskLevel: 'safe',
      },
      {
        title: 'Understand the conflict markers',
        explanation:
          'In each conflicted file, the lines between <<<<<<< and ======= are your current branch version, and the lines between ======= and >>>>>>> are the incoming version. ' +
          'Edit the file to keep the content you want and delete all three marker lines. git diff shows the remaining conflicts.',
        command: 'git diff',
        riskLevel: 'safe',
      },
      {
        title: 'Mark each resolved file',
        explanation: 'Stages a file after you remove its conflict markers, telling Git the conflict in that file is resolved.',
        command: 'git add <file>',
        riskLevel: 'safe',
      },
      {
        title: 'Finish the merge',
        explanation: 'Creates the merge commit once every conflicted file is staged.',
        command: 'git commit',
        riskLevel: 'safe',
      },
      {
        title: 'Or cancel the merge',
        explanation:
          'If you want to start over, git merge --abort stops the merge and returns your branch to the pre-merge state. ' +
          'Any conflict resolutions you made in this merge are lost.',
        command: 'git merge --abort',
        riskLevel: 'caution',
      },
    ],
  },

  detached_head: {
    title: 'Detached HEAD: you are not on a branch',
    summary:
      'HEAD points to a commit instead of a branch. You can look around and even commit, but new commits belong to no branch ' +
      'and can be hard to find after you switch away. Create a branch first to keep them.',
    severity: 'medium',
    assumptions: [ASSUME_BRANCH_PLACEHOLDER, ASSUME_UNCOMMITTED_UNKNOWN],
    steps: [
      {
        title: 'Check where HEAD is',
        explanation: 'Confirms the detached HEAD state and shows any uncommitted changes.',
        command: 'git status',
        riskLevel: 'safe',
      },
      {
        title: 'Keep the current commit on a new branch',
        explanation:
          'Creates a new branch at the current commit and switches to it, so any commits made while detached stay reachable.',
        command: 'git switch -c <new-branch-name>',
        riskLevel: 'safe',
      },
      {
        title: 'Check the saved commits',
        explanation: 'Shows the latest commits on the new branch so you can confirm your work is there.',
        command: 'git log --oneline -n 5',
        riskLevel: 'safe',
      },
      {
        title: 'Return to your usual branch',
        explanation:
          'Switches back to your normal branch. Do this only after creating the new branch above. You can later merge the new branch into it.',
        command: 'git switch <branch>',
        riskLevel: 'safe',
      },
    ],
  },

  stuck_rebase: {
    title: 'Rebase in progress: Git is waiting for you',
    summary:
      'A rebase stopped partway, usually because one of the replayed commits conflicts with the new base. ' +
      'Git keeps the rebase open until you continue, skip the current commit, or abort the whole rebase.',
    severity: 'medium',
    assumptions: [ASSUME_BRANCH_PLACEHOLDER],
    steps: [
      {
        title: 'Inspect the rebase state',
        explanation: 'Shows that a rebase is in progress, which commit stopped, and which files have conflicts.',
        command: 'git status',
        riskLevel: 'safe',
      },
      {
        title: 'Resolve conflicts and continue',
        explanation:
          'Fix the conflict markers in each file, stage the files with git add, then run git rebase --continue to replay the remaining commits.',
        command: 'git add <file> && git rebase --continue',
        riskLevel: 'safe',
      },
      {
        title: 'Skip the current commit',
        explanation:
          'Drops the commit that stopped the rebase and continues with the next one. The changes in the skipped commit are left out of the rebased branch.',
        command: 'git rebase --skip',
        riskLevel: 'caution',
      },
      {
        title: 'Or abort the rebase',
        explanation:
          'git rebase --abort stops the rebase and returns your branch to the pre-rebase state, as if the rebase never started.',
        command: 'git rebase --abort',
        riskLevel: 'caution',
      },
    ],
  },

  lost_commits: {
    title: 'Lost commits: recover them from the reflog',
    summary:
      'Your commits likely still exist even though your branch no longer shows them, for example after a reset. ' +
      'Git records every previous position of HEAD in the reflog, so you can find the commit and put a branch on it.',
    severity: 'high',
    assumptions: [
      'The lost commits are assumed to still be in the reflog; Git removes old reflog entries after a while.',
      ASSUME_UNCOMMITTED_UNKNOWN,
    ],
    steps: [
      {
        title: 'List previous HEAD positions',
        explanation:
          'Shows where HEAD pointed before, newest first. Find the entry from just before the commits disappeared and note its commit hash.',
        command: 'git reflog',
        riskLevel: 'safe',
      },
      {
        title: 'Create a backup branch at the lost commit',
        explanation:
          'Creates a new branch pointing at the commit you found, without changing your current branch or files. Replace <commit> with the hash.',
        command: 'git branch <backup-name> <commit>',
        riskLevel: 'safe',
      },
      {
        title: 'Verify the backup',
        explanation: 'Lists the commits on the backup branch so you can confirm the lost work is there.',
        command: 'git log --oneline <backup-name>',
        riskLevel: 'safe',
      },
    ],
  },

  unknown: {
    title: 'Unrecognized Git problem: start by inspecting',
    summary:
      'GitPulse did not recognize this as one of its known incident types. These read-only commands show the state of your ' +
      'repository so you can understand the problem before changing anything.',
    severity: 'low',
    assumptions: [UNKNOWN_ASSUMPTION],
    steps: [
      {
        title: 'Check the repository state',
        explanation: 'Shows your current branch, staged and unstaged changes, and any operation in progress.',
        command: 'git status',
        riskLevel: 'safe',
      },
      {
        title: 'Review recent commits',
        explanation: 'Lists the last 10 commits on your current branch.',
        command: 'git log --oneline -n 10',
        riskLevel: 'safe',
      },
      {
        title: 'Review recent HEAD movements',
        explanation: 'Lists the last 10 positions of HEAD, which helps find commits that seem to be missing.',
        command: 'git reflog -n 10',
        riskLevel: 'safe',
      },
    ],
  },
};

export function playbookFor(type: IncidentType): Playbook {
  return PLAYBOOKS[type];
}
