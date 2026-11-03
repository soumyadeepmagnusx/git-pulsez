/**
 * Sample_Incidents (design: "Sample_Incidents"; Req 2.1, 2.5).
 *
 * Exactly 5 realistic terminal outputs, one per Supported_Incident_Type.
 * Each sample matches only its own type's Fallback_Engine triggers.
 */

import type { SupportedIncidentType } from '../shared/analysisContract';

export interface SampleIncident {
  id: SupportedIncidentType;
  label: string;
  incidentText: string;
}

const REJECTED_PUSH = `$ git push origin main
To github.com:acme/web-app.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'github.com:acme/web-app.git'
hint: Updates were rejected because the remote contains work that you do
hint: not have locally. This is usually caused by another repository pushing
hint: to the same ref. You may want to first integrate the remote changes
hint: (e.g., 'git pull ...') before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.`;

const MERGE_CONFLICT = `$ git merge feature/login
Auto-merging src/auth/session.ts
CONFLICT (content): Merge conflict in src/auth/session.ts
Auto-merging src/config.ts
CONFLICT (content): Merge conflict in src/config.ts
Automatic merge failed; fix conflicts and then commit the result.`;

const DETACHED_HEAD = `$ git checkout 3f9c2a1
Note: switching to '3f9c2a1'.

You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

HEAD is now at 3f9c2a1 Fix header layout on small screens

$ git status
HEAD detached at 3f9c2a1
nothing to commit, working tree clean`;

const STUCK_REBASE = `$ git rebase -i main
Auto-merging src/api/client.ts
error: could not apply 5d6e7f8... Update API client
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".

$ git status
interactive rebase in progress; onto 9e4b7c2
Last commands done (2 commands done):
   pick 1a2b3c4 Add retry logic
   pick 5d6e7f8 Update API client
Next command to do (1 remaining command):
   pick 0a1b2c3 Add tests for API client
  (use "git rebase --edit-todo" to view and edit)
You are currently editing a commit while rebasing branch 'feature/api' on '9e4b7c2'.
  (fix the files and run "git rebase --continue")

Unmerged paths:
  (use "git restore --staged <file>..." to unstage)
  (use "git add <file>..." to mark resolution)
	both modified:   src/api/client.ts`;

const LOST_COMMITS = `$ git reset --hard HEAD~3
HEAD is now at 4c5d6e7 Update README

$ git reflog -n 5
4c5d6e7 HEAD@{0}: reset: moving to HEAD~3
b8e9f01 HEAD@{1}: commit: Add payment webhook handler
a7c3d22 HEAD@{2}: commit: Validate webhook signatures
e1f2a3b HEAD@{3}: commit: Add payment client
4c5d6e7 HEAD@{4}: commit: Update README`;

/** Exactly 5 samples, one per Supported_Incident_Type (Req 2.1). */
export const SAMPLE_INCIDENTS: readonly SampleIncident[] = [
  { id: 'rejected_push', label: 'Rejected push', incidentText: REJECTED_PUSH },
  { id: 'merge_conflict', label: 'Merge conflict', incidentText: MERGE_CONFLICT },
  { id: 'detached_head', label: 'Detached HEAD', incidentText: DETACHED_HEAD },
  { id: 'stuck_rebase', label: 'Stuck rebase', incidentText: STUCK_REBASE },
  { id: 'lost_commits', label: 'Lost commits', incidentText: LOST_COMMITS },
];
