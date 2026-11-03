# Implementation Plan: GitPulse Recovery Assistant

## Overview

This plan follows the design's 7-step Implementation priority and the Test execution order in the Testing Strategy. All code is TypeScript (React + Vite + Tailwind CSS + Vitest + fast-check).

1. Shared contract and the safety core: shell tokenizer, Git command parser, risk classifier, safeguard matchers, Safety_Validator.
2. Focused example-based safety unit tests (Requirement 16 table, `preserve_changes` matcher examples, classifier edge examples).
3. Fallback_Engine and the five Sample_Incidents, with detection and contract tests.
4. Analyzer, History_Store, Dashboard with copy-only command controls, plus component, History_Store, Analyzer, smoke, and static tests.
5. Full Test_Suite (`npx vitest --run`) and `npm run build` checkpoint.
6. Deployment guide, then the user deploys the static frontend and verifies the public URL.
7. Remaining property-based tests (Properties 1–28), then the optional Bedrock_Handler / Lambda work and backend tests.

All 28 property tests and all example, smoke, and static tests listed in the design are required. Only the Bedrock_Handler / Lambda and backend test sub-tasks are optional (marked `*`). The frontend build and tests must pass with no AWS credentials, no AWS SDK, and no `backend/` dependencies installed (Req 23.6).

## Tasks

- [x] 1. Set up the project and the shared contract
  - [x] 1.1 Scaffold the Vite + React + TypeScript frontend
    - Create `package.json` with React, Vite, Tailwind CSS, Lucide React, Vitest, jsdom, @testing-library/react, @testing-library/user-event, and fast-check; no `@aws-sdk/*`, database, or auth packages
    - Create `tsconfig.json`, `vite.config.ts` (Vitest config with jsdom environment), `tailwind.config.ts`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/index.css`
    - Add an ESLint config with a `no-restricted-imports` rule that blocks `backend/*` and `@aws-sdk/*` imports from `src/`
    - Add npm scripts: `dev`, `build`, `test` (`vitest --run`), `lint`
    - Create the module layout directories from the design (`src/shared`, `src/lib/*`, `src/data`, `src/components`, `src/hooks`, `tests/`)
    - _Requirements: 23.1, 23.3, 23.6, 23.7, 24.10_

  - [x] 1.2 Implement the shared contract in `src/shared/analysisContract.ts`
    - Define `SUPPORTED_INCIDENT_TYPES`, `IncidentType`, `Confidence`, `Severity`, `AnalysisMode`, `RiskLevel`, `RISK_ORDER`, `MAX_INCIDENT_CHARS`, `RESIDUAL_RISK_LABEL`, `SAFETY_OVERCLAIM_PHRASES`
    - Define `RecoveryStep`, `AnalysisResult`, `HistoryEntry`, `StoredHistory`, and the `FallbackReason` type
    - Implement the strict hand-written `isAnalysisResult` (enum checks, string types, at least 1 step, integer `stepNumber` 1..n consecutive, rejects unknown keys, optional keys absent or string)
    - Implement `isHistoryEntry`, `containsOverclaim` (case-insensitive), and `maxRisk`
    - Zero dependencies, so `backend/` can import it via esbuild without the frontend importing `backend/`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 11.22, 23.7_

- [x] 2. Implement the safety core (command parsing, classification, safeguards, Safety_Validator)
  - [x] 2.1 Implement the shell tokenizer in `src/lib/safety/shellTokenizer.ts`
    - Split a command into segments on unquoted `&&`, `||`, `;`, `|`, and newlines
    - Split each segment into shell words honoring single quotes, double quotes, and backslash escapes
    - An unclosed quote tokenizes the remainder as one word (conservative; never lowers risk)
    - _Requirements: 11.1, 11.2_

  - [x] 2.2 Implement the Git command parser in `src/lib/safety/gitCommandParser.ts`
    - Detect Git invocations (first word `git`), skip global options (`-C <path>`, `-c <k=v>`, `--git-dir=…`, `--work-tree=…`, `--no-pager`, `-P`), read the subcommand
    - Parse options into the `GitInvocation` shape: `longOpts` map (with `--name=value`), expanded short-flag groups (`-fdx` → `f`,`d`,`x`), `positionals`, `afterDoubleDash`, and the raw `words`
    - Apply the per-subcommand table of value-taking short options (`stash`: `m`; `commit`: `m`,`F`,`C`,`c`; `clean`: `e`; `push`: `o`; `checkout`: `b`,`B`), consuming the rest of the group or the next word
    - Keep flags case-sensitive so `-D` ≠ `-d`, and keep `--force-with-lease` a distinct long option from `--force`
    - _Requirements: 11.1_

  - [x] 2.3 Implement the risk classifier in `src/lib/safety/riskClassifier.ts`
    - Implement `classifyCommand(command): RiskyCommand[]` in order of appearance across segments
    - Rules: `reset_hard` (`--hard`, destructive); `checkout_force` (`--force` or `-f`, destructive); `clean_force` (`--force` or `-f`, destructive, including `-nf`); `push_force` (`--force` or `-f`, destructive); `push_force_with_lease` (`--force-with-lease[=<ref>]` with no `--force`/`-f`, caution); `branch_force_delete` (`-D`, or `-d`/`--delete` with `-f`/`--force`, destructive)
    - Not risky: `git clean -n`/`--dry-run` without force, `git branch -d`/`--delete` without force, plain `git push`, `git checkout <branch>`, `git status`, `git commit -m "--force"`
    - Extract `clean` details (`d`, `x`, `X`, pathspecs), `push` target (remote = first positional or `origin`; branch = refspec after `:`, with leading `+` and `refs/heads/` stripped, or `<branch>`), and `branchNames` (positionals or `<branch>`)
    - _Requirements: 11.1, 11.13, 12.1, 12.4, 13.1, 13.8, 14.1, 14.2, 14.7, 14.8, 15.1, 15.4, 15.6_

  - [x] 2.4 Implement warning texts in `src/lib/safety/warnings.ts`
    - Add the fixed constants from the design's warning table: `RESET_UNCOMMITTED`, `BACKUP_BRANCH_LIMIT`, `CHECKOUT_FORCE`, `STASH_NOT_GUARANTEE`, `STASH_IGNORED`, `UNPROTECTED_DATA`, `CLEAN_PERMANENT`, `CLEAN_X`, `CLEAN_BIG_X`, `PUSH_FORCE_OVERWRITE`, `PUSH_FORCE_LEASE_ADVICE`, `LEASE_LIMITS`, `LEASE_CONDITIONS` (with `<remote>`/`<branch>` substitution), `BRANCH_REFLOG_LIMIT`, `BRANCH_TAG_BACKUP` (with `<branch>` substitution), `GENERIC_DESTRUCTIVE_WARNING`, and the residual label sentence `Risk remains after safeguards.`
    - Implement `warningTextsFor(risky: RiskyCommand): string[]` returning texts in a fixed order per operation, including `CLEAN_X` / `CLEAN_BIG_X` only when the flag is present
    - No constant contains a Safety_Overclaim_Phrase; only the residual sentence contains `RESIDUAL_RISK_LABEL`
    - _Requirements: 11.5, 11.6, 11.7, 11.22, 12.2, 12.3, 12.5, 12.9, 12.10, 12.11, 13.2, 13.3, 13.4, 14.3, 14.4, 14.5, 14.11, 15.2, 15.3_

  - [x] 2.5 Implement safeguard sets and matchers in `src/lib/safety/safeguards.ts`
    - Implement `SafeguardSpec` and `safeguardSetFor(risky)`: `reset_hard`/`checkout_force` → `inspect_status`, `preserve_changes`; `clean_force` → `clean_dry_run` (canonical `git clean -n` + `d`,`x`,`X` in that order + same pathspecs after `--`); push operations → `fetch_remote`, `inspect_remote_log`; `branch_force_delete` → one `inspect_branch_log` per branch, then `list_no_merged`
    - Implement matchers: `inspect_status`, `clean_dry_run` (has `-n`/`--dry-run`, no `-f`/`--force`, equal `d`/`x`/`X` set, equal pathspec set, any order/grouping), `fetch_remote` (any `fetch`), `inspect_remote_log` (`log` with `HEAD..<remote>/<branch>`; any `<name>` when branch is the `<branch>` placeholder), `inspect_branch_log` (`log` naming the branch), `list_no_merged` (`branch --no-merged` with or without value)
    - Implement the `preserve_changes` matcher exactly per the design algorithm: accept only `git stash push` or implied-push `git stash <options>` whose final untracked state is enabled by `-u`, `--include-untracked`, `-a`, `--all`, or a short group containing `u`/`a`; allow only `-k`, `--keep-index`, `--no-keep-index`, `-q`, `--quiet`, `-m <msg>`, `--message=<msg>`, `--message <msg>`; reject every `git commit` form, plain `git stash`, `git stash push` without an untracked option, `git stash save`, other subcommands, `-p`/`--patch`, `-S`/`--staged`, `--pathspec-from-file`, any pathspec or `--`, any other option, and a later `--no-include-untracked`/`--no-all` (last option wins)
    - A window step satisfies a safeguard if any Git invocation in its command matches
    - Add inserted-step templates (title, explanation, command) from the design; every explanation ends with "This step reduces risk but does not make the next step safe."; reset/checkout safeguards state they do not protect ignored files or data outside the repository; the stash explanation states it saves tracked, staged, and untracked non-ignored changes, ignored files are not saved, and `git stash pop` restores; the dry-run explanation states it lists files and deletes none; the remote-log explanation states listed commits exist only on the remote and will be removed by the force push
    - _Requirements: 11.8, 11.9, 11.10, 12.6, 12.7, 12.8, 12.12, 12.13, 12.14, 12.15, 13.5, 13.6, 13.7, 14.6, 14.7, 14.8, 14.9, 14.10, 15.4, 15.5_

  - [x] 2.6 Implement the Safety_Validator in `src/lib/safety/safetyValidator.ts`
    - Implement pure, deterministic `validateSafety(result): AnalysisResult` following the design's validation algorithm
    - Risk level: `maxRisk(input, max classified level)`; non-risky steps keep the input `riskLevel` (never downgrade)
    - Warning: keep the input text unchanged as a prefix; append each missing command-specific text (single-space separator) for every Risky_Command in order; append the residual sentence only if `RESIDUAL_RISK_LABEL` is absent
    - Generic warning: `destructive` step with no Risky_Command and empty/missing warning gets `GENERIC_DESTRUCTIVE_WARNING`
    - Safeguards: required = concatenated Safeguard_Sets in order of appearance; window = output steps emitted after the last emitted Risky_Step; greedy ordered-subsequence prefix match → insert `required[k..]` immediately before the Risky_Step as `safe` steps with no `warningMessage`/`backupPrerequisite`
    - Set `backupPrerequisite` on Risky_Steps to the full required canonical commands joined with ` then `; leave non-risky steps' value unchanged
    - Renumber `stepNumber` 1..n; preserve `analysisMode` and all other fields; omit optional keys rather than setting `undefined`
    - Ensure idempotence (a second pass changes nothing)
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.20, 11.21, 11.22, 14.12_

- [x] 3. Write the focused safety example tests (Implementation priority step 2)
  - [x] 3.1 Write classifier and parser edge example tests in `tests/safety/riskClassifier.test.ts`
    - `git push --force-with-lease=main origin main` → caution; `git push origin main --force-with-lease -f` → destructive; `git branch -d -f old` and `git branch --delete --force old` → destructive; `git clean -nf` → destructive; `git -C repo reset --hard` → destructive; `git reset --hard && git clean -fdx` → both, in order; `git commit -m "--force"` → not risky
    - Tokenizer cases: quotes, escapes, `&&`/`||`/`;`/`|`/newline segments, unclosed quote
    - Push target extraction (named, omitted remote/branch, `+refs/heads/x`, `src:dst`) and branch-name extraction
    - _Requirements: 11.1, 11.13, 12.1, 12.4, 13.1, 13.8, 14.1, 14.2, 14.7, 14.8, 15.1, 15.4, 15.6_

  - [x] 3.2 Write the `preserve_changes` matcher example tests in `tests/safety/preserveChanges.test.ts`
    - For each row of the design's matcher table, build a window of `git status` then the listed command, followed by `git reset --hard HEAD~1`; repeat with `git checkout -f main`
    - Accepted (no insertion): `git stash push -u`, `--include-untracked`, `-a`, `--all`, `-um "wip"`, `-ku`, `-u -m "wip"`, `git stash -u`, `git stash --include-untracked`, `git stash -a`, `git stash --all`, `git stash -um "wip"`
    - Rejected (inserts `git stash push -u`): `git commit -m "wip"`, `git commit -am "wip"`, `git stash`, `git stash push`, `git stash push -m "wip"`, `git stash push -u --no-include-untracked`, `git stash push -u -- src/`, `git stash push -p -u`, `git stash save -u`
    - A window with only `git commit -am "wip"` (no `git status`) receives both `git status` and `git stash push -u`
    - _Requirements: 12.6, 12.7, 12.13, 12.14, 12.15, 11.8, 11.9_

  - [x] 3.3 Write Requirement 16 risky-category tests in `tests/safety/safetyValidator.categories.test.ts`
    - 16.1 `git reset --hard HEAD~1`; 16.2 `git clean -f`, `-fd`, `-fx`, `-fdx` (with `-n`, `-nd`, `-nx`, `-ndx` dry runs and `CLEAN_X` for `-x` variants); 16.3 `git push --force origin feature` and `git push -f origin feature`; 16.4 `git push --force-with-lease origin feature`; 16.5 `git checkout -f main`; 16.6 `git branch -D feature`
    - Assert classified `riskLevel`, exact warning constants, safeguard commands in order immediately before the Risky_Step, and the Residual_Risk_Label
    - 16.14: reset/checkout warnings contain `STASH_NOT_GUARANTEE`, `STASH_IGNORED`, `UNPROTECTED_DATA`; inserted stash explanation states ignored files are not saved
    - 16.15: lease warning contains `LEASE_CONDITIONS` with `origin`/`feature`
    - 16.12: run every case for `analysisMode` `fallback_demo` and `bedrock_ai`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.12, 16.14, 16.15, 12.2, 12.3, 12.5, 12.9, 12.10, 12.11, 13.2, 13.3, 13.5, 14.3, 14.4, 14.5, 14.6, 14.11, 15.2, 15.3, 15.4_

  - [x] 3.4 Write non-downgrade, warning-preservation, and window tests in `tests/safety/safetyValidator.invariants.test.ts`
    - 16.7: each risky command with input `safe` → `caution`/`destructive`; lease with input `destructive` stays `destructive`
    - 16.8: non-empty input warning appears unchanged in output
    - 16.10: complete window → zero inserted; window with only the leading safeguard → only the remaining safeguard inserted
    - 16.11: `git clean -nd`, `git status`, `git branch -d feature`, `git push origin feature`, `git checkout main` → not risky, input `riskLevel` kept, zero inserted
    - 16.13: complete window + non-empty warning → classified (or more severe input) level, input warning, full specific text, label exactly once
    - Generic destructive warning for an unclassified `destructive` step (Req 11.7); renumbering and `backupPrerequisite` values (Req 11.11, 11.12); multi-command concatenated safeguards (Req 11.13)
    - Run for both Analysis_Modes
    - _Requirements: 16.7, 16.8, 16.10, 16.11, 16.12, 16.13, 11.2, 11.3, 11.4, 11.6, 11.7, 11.8, 11.9, 11.11, 11.12, 11.13, 11.20, 11.21, 14.12_

  - [x] 3.5 Write idempotence and no-overclaim tests in `tests/safety/safetyValidator.idempotence.test.ts`
    - 16.9: for every risky command case, `validateSafety(validateSafety(r))` deep-equals `validateSafety(r)`
    - 16.16: output warnings and every inserted explanation contain zero Safety_Overclaim_Phrases (case-insensitive)
    - Assert no constant in `warnings.ts` or the safeguard templates contains a Safety_Overclaim_Phrase, and only the residual sentence contains `RESIDUAL_RISK_LABEL`
    - Run for both Analysis_Modes
    - _Requirements: 16.9, 16.12, 16.16, 11.14, 11.22_

- [ ] 4. Checkpoint - Safety core verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the Fallback_Engine and Sample_Incidents (Implementation priority step 3)
  - [x] 5.1 Implement trigger patterns in `src/lib/fallback/patterns.ts`
    - Linear-time substring triggers per type from the design table (case-insensitive lost-commit descriptions)
    - `PRIORITY = ['stuck_rebase','merge_conflict','lost_commits','detached_head','rejected_push']`
    - `detectIncidentTypes(text)` returns all matched types in priority order
    - Terminal-output line heuristic used for the plain-language confidence cap
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 7.1, 8.4, 10.5_

  - [x] 5.2 Implement evidence extraction in `src/lib/fallback/extractors.ts`
    - Trimmed lines containing matched triggers; `Merge conflict in <path>` lines and captured paths; `onto <hash>` and the hash; reflog lines `<hash> HEAD@{n}: …`
    - Every entry is an exact substring of the Incident_Text; dedupe preserving first appearance
    - _Requirements: 4.2, 6.3, 7.3, 10.1_

  - [x] 5.3 Implement playbooks in `src/lib/fallback/playbooks.ts`
    - Step templates per type exactly as in the design's playbook table, including summaries (remote has commits the local branch lacks; HEAD points to a commit instead of a branch) and the `git merge --abort` / `git rebase --abort` descriptions
    - `unknown` playbook: `git status`, `git log --oneline -n 10`, `git reflog -n 10`, all `safe`, with the "could not match" assumption
    - Placeholder assumptions (remote `origin`, `<branch>`, uncommitted changes unknown)
    - Severity per type; playbooks contain no Risky_Commands
    - _Requirements: 3.2, 3.3, 4.3, 4.4, 5.2, 5.3, 6.2, 7.2, 8.2, 8.3, 10.2_

  - [x] 5.4 Implement `analyzeFallback` in `src/lib/fallback/fallbackEngine.ts`
    - Pure, synchronous; selects the highest-priority type and adds the "also matches" assumption for each other match
    - Confidence: `unknown` → `low`; plain-language input → at most `medium`; fewer than 2 evidence entries → at most `medium`; otherwise `high`
    - Sets `analysisMode: 'fallback_demo'`, numbers steps 1..n, output passes `isAnalysisResult`
    - _Requirements: 8.1, 8.4, 9.1, 9.2, 9.3, 9.4, 10.5, 10.6, 19.5, 21.5_

  - [x] 5.5 Create the five Sample_Incidents in `src/data/sampleIncidents.ts`
    - Exactly 5 realistic terminal outputs, one per Supported_Incident_Type, each matching only its own type's triggers
    - _Requirements: 2.1, 2.5_

  - [x] 5.6 Write Fallback_Engine example tests in `tests/fallback/fallbackEngine.test.ts`
    - Each Sample_Incident yields its own type (2.5); per-type playbook commands, order, and summary text; `unknown` safe-only steps and assumption; priority resolution with an "also matches" assumption
    - Evidence extraction examples (paths, hashes, reflog lines); placeholder assumptions for `rejected_push` (10.2); plain-language confidence cap
    - A 20,000-character worst-case input completes in under 500 ms (21.5 regression guard)
    - _Requirements: 2.5, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 10.1, 10.2, 10.5, 21.5_

  - [x] 5.7 Write contract tests in `tests/shared/analysisContract.test.ts`
    - `isAnalysisResult` accepts valid results and every Fallback_Engine output; rejects bad enums, wrong types, unknown keys, empty `recoverySteps`, non-integer or non-consecutive `stepNumber`
    - `containsOverclaim` case-insensitivity; `maxRisk` ordering; JSON round-trip example
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 11.22, 23.4_

- [ ] 6. Checkpoint - Fallback engine verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement input validation, Analyzer, and History_Store (Implementation priority step 4)
  - [x] 7.1 Implement `src/lib/input/validateIncidentText.ts`
    - `empty` with "Incident text is required." for empty/whitespace-only; `too_long` with "Incident text must be 20,000 characters or fewer." for > 20,000 UTF-16 code units; otherwise `ok`
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x] 7.2 Implement `src/config.ts` and `src/lib/analyzer/bedrockClient.ts`
    - `config.ts` reads `import.meta.env.VITE_BEDROCK_ENDPOINT_URL` and accepts it only if it parses as an `https:` URL
    - `bedrockClient.ts` is the only module calling `fetch`: POST `{ incidentText }` with `Content-Type: application/json` and a 15 s `AbortController` timeout; distinguishes network/non-2xx errors, timeouts, and unparsable JSON
    - _Requirements: 18.8, 18.9, 19.1, 19.2, 19.3, 24.6_

  - [x] 7.3 Implement the Analyzer in `src/lib/analyzer/analyzer.ts`
    - `analyze(text, deps): Promise<AnalyzeOutcome>`: no endpoint → `analyzeFallback`; endpoint → Bedrock client; errors → `bedrock_error`, abort → `bedrock_timeout`, rejected response → `bedrock_invalid`, each falling back to `analyzeFallback`
    - `acceptBedrockResult`: `isAnalysisResult` passes, `analysisMode === 'bedrock_ai'`, no Risky_Step `title`/`explanation`/`warningMessage` contains a Safety_Overclaim_Phrase, no `warningMessage` contains `RESIDUAL_RISK_LABEL` more than once
    - Pass every result through `validateSafety`, then apply the evidence confidence cap (fewer than 2 evidence entries → not `high`); never rewrite `analysisMode`
    - Reject (throw) if the Fallback_Engine or Safety_Validator throws
    - _Requirements: 9.5, 10.6, 11.16, 18.8, 18.9, 19.1, 19.2, 19.3, 19.5, 19.6, 21.4_

  - [x] 7.4 Implement the History_Store in `src/lib/history/historyStore.ts`
    - `HISTORY_KEY = 'gitpulse.history.v1'`, `MAX_HISTORY = 10`
    - Pure `addEntry` (prepend, sort by `createdAt` desc, keep 10), `serializeHistory`, `parseHistory` (version 1, ≤10 entries, valid fields, `isAnalysisResult`; otherwise `null`)
    - `createHistoryStore(storage)`: `load` (invalid → `[]` and remove key, ignoring removal errors), `save` (catch write errors → `persisted: false`), `clear`
    - _Requirements: 20.1, 20.2, 20.5, 20.6, 20.7, 20.8, 20.9_

  - [x] 7.5 Write Analyzer example tests in `tests/analyzer/analyzer.test.ts`
    - No endpoint → fallback (19.2); configured endpoint → exactly one POST to that URL with `{ incidentText }` (19.1, 18.9); fake-timer 15 s timeout → `bedrock_timeout` fallback (19.3); non-2xx → `bedrock_error`; invalid body, wrong mode, overclaim, duplicated label → `bedrock_invalid` (9.5)
    - Accepted Bedrock result keeps `bedrock_ai` and passes through `validateSafety` (11.16, 19.6); confidence cap applied (10.6); non-`https:` endpoint treated as not configured
    - All network calls use a mocked `fetchFn`
    - _Requirements: 9.5, 10.6, 11.16, 18.9, 19.1, 19.2, 19.3, 19.6, 23.4_

  - [x] 7.6 Write History_Store example tests in `tests/history/historyStore.test.ts`
    - Save/load with an in-memory storage; 11th entry drops the oldest; newest-first order; write failure returns `persisted: false` (20.8); `clear` removes the key (20.5); invalid JSON and invalid shape are discarded and the key is removed (20.7)
    - _Requirements: 20.1, 20.2, 20.5, 20.6, 20.7, 20.8, 23.4_

- [x] 8. Build the Dashboard (Implementation priority step 4)
  - [x] 8.1 Implement the `useGitPulse` reducer hook in `src/hooks/useGitPulse.ts`
    - State `{ text, activeSampleId, validationMessage, status, outcome?, error?, history, historyWarning? }`; actions `edit`, `selectSample`, `submit`, `succeeded`, `failed`, `reset`, `selectHistory`, `clearHistory`
    - Submit validates input first and keeps the Analyzer idle on failure; on success saves a History_Entry (with `fallbackReason`) and sets "History could not be saved." when `persisted` is false; editing clears the active sample; reset clears text, validation, and result; selecting history restores text and result without analysis
    - Load history from the store on mount
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 2.2, 2.3, 2.4, 20.1, 20.4, 20.5, 20.6, 20.8, 21.2, 21.4_

  - [x] 8.2 Implement input and state components in `src/components/`
    - `IncidentInputPanel` (multi-line `<textarea>`, "Analyze Incident" button disabled while loading, reset button, `n / 20,000` counter, inline `role="alert"` validation message)
    - `SampleIncidentBar` (5 buttons with `aria-pressed`)
    - `EmptyState` (paste Git output or select a sample), `LoadingIndicator`, `ErrorState` (description + retry)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 2.1, 2.3, 2.4, 21.1, 21.2, 21.4, 22.5, 22.6_

  - [x] 8.3 Implement result header components in `src/components/`
    - `AnalysisHeader` (title, summary, incidentType, severity, "Confidence: <value>" with "Likely diagnosis, not certain" wording), `ModeBadge` ("Amazon Bedrock AI" / "Deterministic Fallback / Demo Mode"), `FallbackNotice` (shown when `fallbackReason` is set), `EvidenceLists` ("Detected Evidence" and "Assumptions" with "No entries available." placeholders)
    - _Requirements: 10.3, 10.4, 10.7, 17.1, 19.4, 19.7, 19.8, 19.9_

  - [x] 8.4 Implement recovery plan components in `src/components/`
    - `RecoveryPlan` (sorted by `stepNumber`) and `RecoveryStepCard` (number, title, explanation, command in a monospace terminal card)
    - `RiskBadge` (text label + emerald/amber/rose), `ResidualRiskBadge` (when the warning contains the label), `WarningCallout` (rose for destructive, amber for caution), `BackupPrerequisite` ("Run these first: …"), `ManualRunReminder` for caution/destructive
    - `CommandBlock` (`<pre><code>`, selectable, read-only) + `CopyButton` (`aria-label="Copy command"`, writes the exact command, "Copied" for 2 s, failure message "Copying failed. Select the command text and copy it manually."); zero run/execute/send-to-terminal controls
    - No component adds Safety_Overclaim_Phrases for Risky_Steps
    - _Requirements: 11.17, 11.18, 11.19, 11.23, 17.2, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 22.6, 22.7_

  - [x] 8.5 Implement `HistoryPanel` in `src/components/HistoryPanel.tsx`
    - Entries newest first with title, `ModeBadge`, and creation time; select button per entry; clear-history button; empty history message; history warning display
    - _Requirements: 19.9, 20.3, 20.4, 20.5, 20.8, 21.3_

  - [x] 8.6 Wire the `App` layout and styles in `src/App.tsx` and `src/main.tsx`
    - Connect `useGitPulse` with `createHistoryStore(window.localStorage)`, `analyze` with `config.ts`, and all components
    - Single column by default, `lg:grid-cols-2` at ≥1024 px; `bg-slate-950` page, `bg-slate-900` surfaces, cyan/violet accents, `font-mono` commands; `focus-visible:ring-2 ring-cyan-400` on all controls; Lucide icons `aria-hidden`
    - _Requirements: 21.1, 22.1, 22.2, 22.3, 22.4, 22.5, 23.2_

  - [x] 8.7 Write input, sample, and state component tests in `tests/components/inputAndStates.test.tsx`
    - Validation messages for empty and over-limit input with the Analyzer not called; counter text; reset clears text, validation, and result (1.4–1.7)
    - Sample buttons replace text, set `aria-pressed`, and editing clears it (2.1–2.4)
    - Empty, loading (button disabled), error with retry, and empty-history states (21.1–21.4)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 21.1, 21.2, 21.3, 21.4_

  - [x] 8.8 Write result display and copy component tests in `tests/components/recoveryPlan.test.tsx`
    - Header fields, confidence wording, evidence placeholders (10.3, 10.4, 10.7, 17.1); step order and card contents (17.2, 17.3)
    - Risk badge text and color classes, residual badge, rose/amber callouts, backup prerequisite label, manual-run reminder, no overclaim text on Risky_Steps including with a complete safeguard window (11.17–11.19, 11.23, 17.4, 17.5, 18.7, 22.7)
    - Copy success with fake timers (2 s), copy failure message, read-only selectable command with no run/execute controls, accessible copy-button name (18.1–18.4, 18.6, 22.6)
    - _Requirements: 10.3, 10.4, 10.7, 11.17, 11.18, 11.19, 11.23, 17.1, 17.2, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3, 18.4, 18.6, 18.7, 22.6, 22.7_

  - [x] 8.9 Write mode, history, layout, and accessibility component tests in `tests/components/modeHistoryLayout.test.tsx`
    - Mode badge texts and fallback notice, including history reloads (19.4, 19.7–19.9); history select restores without analysis and clear empties the panel (20.3–20.5); "History could not be saved." on write failure (20.8)
    - Layout classes `lg:grid-cols-2` and single-column default (22.2, 22.3); computed contrast ratio ≥ 4.5:1 for each text/background token pair (22.4); keyboard tab order and `focus-visible` classes (22.5); dark theme tokens (22.1)
    - _Requirements: 19.4, 19.7, 19.8, 19.9, 20.3, 20.4, 20.5, 20.8, 22.1, 22.2, 22.3, 22.4, 22.5_

  - [x] 8.10 Write smoke and static checks in `tests/static/` and `scripts/check-dist-secrets.mjs`
    - Test scanning `src/` for imports of `backend/`, `@aws-sdk/`, `child_process`, `fs`, and for `fetch` calls outside `bedrockClient.ts` (18.5, 18.8, 23.7)
    - Test asserting the frontend `package.json` lists no `@aws-sdk/*`, database, or auth packages (23.3, 24.10)
    - `scripts/check-dist-secrets.mjs` scanning `dist/` for `AKIA[0-9A-Z]{16}`, wired as the `postbuild` npm script so `npm run build` fails on a match (24.6)
    - Ensure `vite build` needs no AWS environment variables (23.1, 23.6)
    - _Requirements: 18.5, 18.8, 23.1, 23.3, 23.6, 23.7, 24.6, 24.10_

- [ ] 9. Checkpoint - Full Test_Suite and build (Implementation priority step 5)
  - Run `npx vitest --run` and `npm run build` with no AWS credentials and no `backend/` dependencies installed; fix any failures.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 23.1, 23.4, 23.5, 23.6_

- [x] 10. Write the deployment guide (Implementation priority step 6)
  - [x] 10.1 Write `docs/DEPLOYMENT.md`
    - Static frontend deployment on AWS Amplify Hosting (build command `npm run build`, output `dist/`), with Vercel and Netlify notes
    - Steps for the user to deploy and verify the public URL (sample incident analysis works in `fallback_demo` mode)
    - `VITE_BEDROCK_ENDPOINT_URL` configuration (must be `https:`, build-time variable)
    - Bedrock_Handler API contract (POST `{ incidentText }`, 200/400/502 responses, CORS) and environment variables (`BEDROCK_MODEL_ID`, `AWS_REGION`, `ALLOWED_ORIGIN`, execution-role credentials)
    - _Requirements: 23.1, 23.2, 24.5, 24.8, 24.9, 24.11_

  - [x] 10.2 Write a static test for the deployment guide in `tests/static/deploymentDoc.test.ts`
    - Assert `docs/DEPLOYMENT.md` exists and contains the API contract, environment variables, Amplify steps, and `VITE_BEDROCK_ENDPOINT_URL` sections
    - _Requirements: 24.9_

- [ ] 11. Checkpoint - Deploy the static frontend and verify the public URL
  - The user deploys the static build following `docs/DEPLOYMENT.md` and confirms the public URL loads and analyzes a Sample_Incident in `fallback_demo` mode.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 23.1, 23.2, 24.11_

- [x] 12. Write safety property-based tests (Implementation priority step 7)
  - Each property test uses fast-check with `{ numRuns: 100 }` or higher and the tag comment `// Feature: gitpulse-recovery-assistant, Property N: <title>`
  - [x] 12.1 Create fast-check arbitraries in `tests/arbitraries/`
    - `arbIncidentText` (noise lines plus optional trigger snippets per type), `arbGitCommand` with a reference classifier (shuffled options, grouped short flags such as `-fdx`/`-um`, quoting, global options, joined segments), `arbStashCommand` (accepted/rejected stash forms and `git commit` forms with expected matcher result), `arbRecoveryStep` / `arbAnalysisResult` (both Analysis_Modes, random Risky_Steps, random partial safeguard windows), `arbHistoryEntries` (0–10 entries with distinct `createdAt`)
    - _Requirements: 23.4_

  - [x] 12.2 Write property test for risky command classification
    - **Property 12: Risky command classification matches the reference model**
    - File `tests/properties/p12-classification.property.test.ts`
    - **Validates: Requirements 11.1, 11.13, 12.1, 12.4, 13.1, 13.8, 14.1, 14.2, 15.1, 15.6**

  - [x] 12.3 Write property test for risk non-downgrade
    - **Property 13: Risk level never decreases**
    - File `tests/properties/p13-risk-no-downgrade.property.test.ts`
    - **Validates: Requirements 11.2, 11.3, 11.20, 14.12**

  - [x] 12.4 Write property test for warning preservation and completeness
    - **Property 14: Warnings are preserved and complete**
    - File `tests/properties/p14-warnings.property.test.ts`
    - **Validates: Requirements 11.4, 11.5, 11.6, 11.13, 11.21, 12.2, 12.3, 12.5, 12.9, 12.10, 12.11, 13.2, 13.3, 13.4, 14.3, 14.4, 14.5, 14.11, 14.12, 15.2, 15.3**

  - [x] 12.5 Write property test for no safety overclaims
    - **Property 15: No safety overclaims**
    - File `tests/properties/p15-no-overclaims.property.test.ts`
    - **Validates: Requirements 11.22**

  - [x] 12.6 Write property test for complete and minimal safeguard insertion
    - **Property 16: Safeguard insertion is complete and minimal**
    - File `tests/properties/p16-safeguard-insertion.property.test.ts`
    - **Validates: Requirements 11.8, 11.9, 11.13, 12.6**

  - [x] 12.7 Write property test for inserted safeguard step shape
    - **Property 17: Inserted safeguard steps are well-formed**
    - File `tests/properties/p17-inserted-steps.property.test.ts`
    - **Validates: Requirements 11.10, 12.8, 12.12, 13.7, 14.10**

  - [x] 12.8 Write property test for renumbering and backup prerequisites
    - **Property 18: Renumbering and backup prerequisites**
    - File `tests/properties/p18-renumber-backup.property.test.ts`
    - **Validates: Requirements 11.11, 11.12**

  - [x] 12.9 Write property test for Safety_Validator idempotence
    - **Property 19: Safety validation is idempotent**
    - File `tests/properties/p19-idempotence.property.test.ts`
    - **Validates: Requirements 11.14, 16.12**

  - [x] 12.10 Write property test for the `preserve_changes` matcher
    - **Property 20: preserve_changes matcher accepts only untracked-inclusive stash push forms**
    - File `tests/properties/p20-preserve-changes.property.test.ts`; include windows of `git status` followed only by `git commit` forms or non-untracked stash forms, asserting `git stash push -u` is inserted
    - **Validates: Requirements 12.6, 12.7, 12.13, 12.14, 12.15**

  - [x] 12.11 Write property test for original step order and content
    - **Property 21: Original steps keep order and content**
    - File `tests/properties/p21-original-steps.property.test.ts`
    - **Validates: Requirements 11.15**

  - [x] 12.12 Write property test for the clean dry-run safeguard
    - **Property 22: Clean dry-run safeguard matches the destructive command**
    - File `tests/properties/p22-clean-dry-run.property.test.ts`
    - **Validates: Requirements 13.5, 13.6**

  - [x] 12.13 Write property test for push safeguards
    - **Property 23: Push safeguards use the push target**
    - File `tests/properties/p23-push-safeguards.property.test.ts`
    - **Validates: Requirements 14.6, 14.7, 14.8, 14.9**

  - [x] 12.14 Write property test for branch deletion safeguards
    - **Property 24: Branch deletion safeguards use the branch name**
    - File `tests/properties/p24-branch-safeguards.property.test.ts`
    - **Validates: Requirements 15.4, 15.5**

  - [x] 12.15 Write property test for unclassified destructive steps
    - **Property 25: Unclassified destructive steps get a warning**
    - File `tests/properties/p25-generic-warning.property.test.ts`
    - **Validates: Requirements 11.7**

- [x] 13. Write input, Fallback_Engine, contract, and Analyzer property-based tests (Implementation priority step 7)
  - [x] 13.1 Write property test for incident text validation
    - **Property 1: Incident text validation**
    - File `tests/properties/p01-input-validation.property.test.ts`
    - **Validates: Requirements 1.3, 1.4, 1.5**

  - [x] 13.2 Write property test for trigger detection
    - **Property 2: Trigger detection**
    - File `tests/properties/p02-trigger-detection.property.test.ts`
    - **Validates: Requirements 3.1, 4.1, 5.1, 6.1, 7.1**

  - [x] 13.3 Write property test for fixed priority resolution
    - **Property 3: Fixed priority resolution**
    - File `tests/properties/p03-priority.property.test.ts`
    - **Validates: Requirements 8.4**

  - [x] 13.4 Write property test for unknown incidents
    - **Property 4: Unknown incidents are safe and low confidence**
    - File `tests/properties/p04-unknown.property.test.ts`
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [x] 13.5 Write property test for playbook content
    - **Property 5: Playbook content per incident type**
    - File `tests/properties/p05-playbooks.property.test.ts`
    - **Validates: Requirements 3.2, 3.3, 4.3, 4.4, 5.2, 5.3, 6.2, 7.2**

  - [x] 13.6 Write property test for grounded evidence
    - **Property 6: Evidence is grounded in the input**
    - File `tests/properties/p06-grounded-evidence.property.test.ts`
    - **Validates: Requirements 10.1**

  - [x] 13.7 Write property test for entity extraction
    - **Property 7: Entity extraction**
    - File `tests/properties/p07-entity-extraction.property.test.ts`
    - **Validates: Requirements 4.2, 6.3, 7.3**

  - [x] 13.8 Write property test for the confidence cap
    - **Property 8: Confidence is capped by evidence**
    - File `tests/properties/p08-confidence-cap.property.test.ts`; Analyzer cases use a mocked `fetchFn`
    - **Validates: Requirements 10.5, 10.6**

  - [x] 13.9 Write property test for well-formed Analyzer output
    - **Property 9: Analyzer output is well-formed**
    - File `tests/properties/p09-analyzer-output.property.test.ts`
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 19.5**

  - [x] 13.10 Write property test for Analysis_Result JSON round trip
    - **Property 10: Analysis_Result JSON round trip**
    - File `tests/properties/p10-json-round-trip.property.test.ts`
    - **Validates: Requirements 9.6**

  - [x] 13.11 Write property test for invalid Bedrock responses
    - **Property 11: Invalid Bedrock responses fall back**
    - File `tests/properties/p11-bedrock-fallback.property.test.ts`; uses a mocked `fetchFn`, no real network calls
    - **Validates: Requirements 9.5, 19.3, 19.6, 11.16**

- [x] 14. Write History_Store property-based tests (Implementation priority step 7)
  - [x] 14.1 Write property test for history cap and order
    - **Property 26: History is capped and ordered**
    - File `tests/properties/p26-history-cap.property.test.ts`
    - **Validates: Requirements 20.1, 20.2, 20.3**

  - [x] 14.2 Write property test for history round trip
    - **Property 27: History round trip**
    - File `tests/properties/p27-history-round-trip.property.test.ts`
    - **Validates: Requirements 20.6, 20.9**

  - [x] 14.3 Write property test for invalid stored history
    - **Property 28: Invalid stored history is discarded**
    - File `tests/properties/p28-invalid-history.property.test.ts`
    - **Validates: Requirements 20.7**

- [x] 15. Checkpoint - All property tests pass
  - Run `npx vitest --run` and `npm run build`; fix any failures without relaxing any safety behavior.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Optional Bedrock_Handler / AWS Lambda (Implementation priority step 7, as time permits)
  - [ ]* 16.1 Set up the backend package in `backend/`
    - `backend/package.json` declaring `@aws-sdk/client-bedrock-runtime`, esbuild, Vitest, and `@types/aws-lambda`; `backend/tsconfig.json`; an esbuild bundle script that inlines `src/shared/analysisContract.ts`
    - The frontend manifest stays free of AWS SDK packages
    - _Requirements: 23.6, 24.10_

  - [ ]* 16.2 Implement the handler in `backend/lambda/analyzeIncident.ts`
    - `OPTIONS` preflight; `POST` with JSON `{ incidentText }`; 400 JSON error for unparsable JSON or missing, whitespace-only, or >20,000-character `incidentText`
    - Call `BedrockRuntimeClient` `ConverseCommand` with `BEDROCK_MODEL_ID` and `AWS_REGION`; credentials from the execution role only
    - System prompt: return only JSON matching the Analysis_Result interface, only input text in `detectedEvidence`, inferences in `assumptions`, no certainty claims with partial evidence, inspection steps before risky commands
    - Parse output, set `analysisMode: 'bedrock_ai'`, validate with `isAnalysisResult`; Bedrock failure or invalid output → 502 JSON error; no credentials, headers, or stack traces in errors
    - CORS headers using `ALLOWED_ORIGIN`, `POST, OPTIONS`, `Content-Type`
    - The handler executes no Git commands and has no file system or repository access
    - _Requirements: 18.8, 24.1, 24.2, 24.3, 24.4, 24.5, 24.7, 24.8_

  - [ ]* 16.3 Write backend tests in `backend/lambda/analyzeIncident.test.ts`
    - Mocked `BedrockRuntimeClient`: valid request → 200 with `bedrock_ai` (24.2); missing, empty, and over-length `incidentText` → 400 (24.3); Bedrock error and invalid model output → 502 (24.4); CORS headers use `ALLOWED_ORIGIN` (24.8); system prompt contains the contract, evidence/assumption separation, and no-certainty instructions (24.7)
    - Runs with the backend's own manifest only
    - _Requirements: 24.2, 24.3, 24.4, 24.7, 24.8_

- [ ] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Only the Bedrock_Handler / Lambda sub-tasks and backend tests (16.1–16.3) are marked `*` as optional. Every property test (Properties 1–28), every Requirement 16 safety test, and every listed example, smoke, and static test is required.
- Task order follows the design's Implementation priority. The sequencing changes when tests are written, not whether they are written. The step-2 example tests (task 3) cover the safety behaviors of Properties 12–20 before deployment.
- Task 11 is performed by the user (deployment and public URL check), guided by `docs/DEPLOYMENT.md` from task 10.
- Use `npx vitest --run` (single run), never watch mode.
- No task executes Git commands, touches the user's repositories, or contacts Git remotes. Command controls are copy-only.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.4"] },
    { "id": 3, "tasks": ["2.3"] },
    { "id": 4, "tasks": ["2.5"] },
    { "id": 5, "tasks": ["2.6"] },
    { "id": 6, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 7, "tasks": ["5.1", "5.2"] },
    { "id": 8, "tasks": ["5.3"] },
    { "id": 9, "tasks": ["5.4"] },
    { "id": 10, "tasks": ["5.5"] },
    { "id": 11, "tasks": ["5.6", "5.7"] },
    { "id": 12, "tasks": ["7.1", "7.2", "7.4"] },
    { "id": 13, "tasks": ["7.3"] },
    { "id": 14, "tasks": ["7.5", "7.6", "8.1"] },
    { "id": 15, "tasks": ["8.2", "8.3", "8.4", "8.5"] },
    { "id": 16, "tasks": ["8.6"] },
    { "id": 17, "tasks": ["8.7", "8.8", "8.9", "8.10"] },
    { "id": 18, "tasks": ["10.1"] },
    { "id": 19, "tasks": ["10.2"] },
    { "id": 20, "tasks": ["12.1"] },
    { "id": 21, "tasks": ["12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8", "12.9", "12.10", "12.11", "12.12", "12.13", "12.14", "12.15", "13.1", "13.2", "13.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9", "13.10", "13.11", "14.1", "14.2", "14.3"] },
    { "id": 22, "tasks": ["16.1"] },
    { "id": 23, "tasks": ["16.2"] },
    { "id": 24, "tasks": ["16.3"] }
  ]
}
```
