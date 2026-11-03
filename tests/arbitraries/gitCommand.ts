/**
 * Grammar-based Git command arbitraries with a reference classifier.
 *
 * Every generator builds its expected Risky_Command list from its own
 * structured choices (the rule table in design.md, "Classification rules"),
 * never by calling `classifyCommand`. Commands mix shuffled options, grouped
 * short flags (`-fdx`, `-df`), quoting, global options, non-Git segments, and
 * several segments joined by `&&`, `||`, `;`, `|`, or newlines.
 */

import fc from 'fast-check';
import type { RiskLevel } from '../../src/shared/analysisContract';
import type { CleanDetails, PushTarget, RiskyOperation } from '../../src/lib/safety/riskTypes';
import { arbBranchName, arbCommitHash, arbCommitMessage, arbPath, arbRemoteName, arbRenderWords, arbSimpleName } from './text';

export const REFERENCE_LEVELS: Readonly<Record<RiskyOperation, RiskLevel>> = {
  reset_hard: 'destructive',
  checkout_force: 'destructive',
  clean_force: 'destructive',
  push_force: 'destructive',
  push_force_with_lease: 'caution',
  branch_force_delete: 'destructive',
};

export const REFERENCE_DEFAULT_REMOTE = 'origin';
export const REFERENCE_BRANCH_PLACEHOLDER = '<branch>';

/** Reference model output for one Risky_Command. */
export interface ExpectedRisky {
  operation: RiskyOperation;
  level: RiskLevel;
  clean?: CleanDetails;
  push?: PushTarget;
  branchNames?: string[];
}

export type SegmentKind =
  | 'reset'
  | 'checkout'
  | 'clean'
  | 'push'
  | 'branch'
  | 'status'
  | 'log'
  | 'fetch'
  | 'commit'
  | 'stash'
  | 'non_git';

/** One generated shell segment. `words` are the exact words the tokenizer must produce. */
export interface GitSegment {
  kind: SegmentKind;
  words: string[];
  risky: ExpectedRisky | null;
}

export interface GeneratedGitCommand {
  command: string;
  segments: GitSegment[];
  /** Expected Risky_Commands, in order of appearance. */
  expected: ExpectedRisky[];
}

function expected(operation: RiskyOperation, extra: Omit<ExpectedRisky, 'operation' | 'level'> = {}): ExpectedRisky {
  return { operation, level: REFERENCE_LEVELS[operation], ...extra };
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/** Random permutation of `items`. */
export function arbPermutation<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

/** Splits short flag characters into random groups, e.g. `['f','d','x']` → `['-fd', '-x']`. */
export function arbShortGroups(flags: readonly string[]): fc.Arbitrary<string[][]> {
  if (flags.length === 0) return fc.constant([]);
  return fc
    .tuple(arbPermutation(flags), fc.array(fc.boolean(), { minLength: flags.length, maxLength: flags.length }))
    .map(([perm, cuts]) => {
      const groups: string[][] = [];
      let current = '';
      perm.forEach((flag, i) => {
        if (i > 0 && cuts[i]) {
          groups.push([`-${current}`]);
          current = '';
        }
        current += flag;
      });
      groups.push([`-${current}`]);
      return groups;
    });
}

/**
 * Shuffles option units (each unit is a list of words kept together) and
 * inserts the positionals at a random point among them; `tail` goes last.
 */
function arbArrange(units: readonly string[][], positionals: readonly string[], tail: readonly string[] = []): fc.Arbitrary<string[]> {
  return fc
    .tuple(arbPermutation(units), fc.integer({ min: 0, max: units.length }))
    .map(([perm, k]) => [...perm.slice(0, k).flat(), ...positionals, ...perm.slice(k).flat(), ...tail]);
}

interface SubArgs {
  kind: SegmentKind;
  subcommand: string;
  args: string[];
  risky: ExpectedRisky | null;
}

// ---------------------------------------------------------------------------
// Risky-capable subcommands
// ---------------------------------------------------------------------------

export const arbResetArgs: fc.Arbitrary<SubArgs> = fc
  .record({
    mode: fc.constantFrom<string | null>('--hard', '--soft', '--mixed', null),
    quiet: fc.boolean(),
    target: fc.option(fc.oneof(fc.constantFrom('HEAD~1', 'HEAD', 'origin/main', 'HEAD@{1}'), arbCommitHash), { nil: undefined }),
  })
  .chain(({ mode, quiet, target }) => {
    const units: string[][] = [];
    if (mode) units.push([mode]);
    if (quiet) units.push(['-q']);
    return arbArrange(units, target ? [target] : []).map((args) => ({
      kind: 'reset' as const,
      subcommand: 'reset',
      args,
      risky: mode === '--hard' ? expected('reset_hard') : null,
    }));
  });

export const arbCheckoutArgs: fc.Arbitrary<SubArgs> = fc
  .record({
    force: fc.constantFrom<string | null>(null, '-f', '--force'),
    quiet: fc.boolean(),
    create: fc.boolean(),
    mergeFb: fc.boolean(),
    name: arbBranchName,
  })
  .chain(({ force, quiet, create, mergeFb, name }) => {
    const shorts: string[] = [];
    const units: string[][] = [];
    const fb = create && mergeFb && force === '-f';
    if (force === '-f' && !fb) shorts.push('f');
    if (force === '--force') units.push(['--force']);
    if (quiet) shorts.push('q');
    if (fb) units.push(['-fb', name]);
    else if (create) units.push(['-b', name]);
    return arbShortGroups(shorts).chain((groups) =>
      arbArrange([...units, ...groups], create ? [] : [name]).map((args) => ({
        kind: 'checkout' as const,
        subcommand: 'checkout',
        args,
        risky: force ? expected('checkout_force') : null,
      })),
    );
  });

export interface CleanArgsOptions {
  /** `force`: always a force option; `noforce`: never; `any` (default). */
  force?: 'any' | 'force' | 'noforce';
}

export function arbCleanArgs(opts: CleanArgsOptions = {}): fc.Arbitrary<SubArgs> {
  const forceChoices: Array<string | null> =
    opts.force === 'force' ? ['-f', '--force'] : opts.force === 'noforce' ? [null] : [null, '-f', '--force'];
  return fc
    .record({
      force: fc.constantFrom(...forceChoices),
      dry: fc.constantFrom<string | null>(null, '-n', '--dry-run'),
      d: fc.boolean(),
      x: fc.boolean(),
      X: fc.boolean(),
      pathspecs: fc.uniqueArray(arbPath, { maxLength: 2 }),
      dashDash: fc.boolean(),
    })
    .chain(({ force, dry, d, x, X, pathspecs, dashDash }) => {
      const shorts: string[] = [];
      const units: string[][] = [];
      if (force === '-f') shorts.push('f');
      if (force === '--force') units.push(['--force']);
      if (dry === '-n') shorts.push('n');
      if (dry === '--dry-run') units.push(['--dry-run']);
      if (d) shorts.push('d');
      if (x) shorts.push('x');
      if (X) shorts.push('X');
      const useDashDash = pathspecs.length > 0 && dashDash;
      return arbShortGroups(shorts).chain((groups) =>
        arbArrange(
          [...units, ...groups],
          useDashDash ? [] : pathspecs,
          useDashDash ? ['--', ...pathspecs] : [],
        ).map((args) => ({
          kind: 'clean' as const,
          subcommand: 'clean',
          args,
          risky: force ? expected('clean_force', { clean: { d, x, X, pathspecs: [...pathspecs] } }) : null,
        })),
      );
    });
}

type PushForce = 'none' | '--force' | '-f' | 'lease' | 'lease=ref' | 'lease+-f' | 'lease+--force';

/** Refspec variants and the destination branch the reference extracts from them. */
const arbRefspec: fc.Arbitrary<{ refspec: string; branch: string }> = fc
  .tuple(arbBranchName, arbSimpleName, fc.integer({ min: 0, max: 6 }))
  .map(([branch, src, variant]) => {
    const refspec = [
      branch,
      `+${branch}`,
      `refs/heads/${branch}`,
      `+refs/heads/${branch}`,
      `${src}:${branch}`,
      `HEAD:refs/heads/${branch}`,
      `+${src}:refs/heads/${branch}`,
    ][variant];
    return { refspec, branch };
  });

interface PushPositionals {
  remote?: string;
  refspec?: { refspec: string; branch: string };
}

export interface PushArgsOptions {
  /** Restrict the force kind; defaults to every kind including plain push. */
  forces?: readonly PushForce[];
}

export function arbPushArgs(opts: PushArgsOptions = {}): fc.Arbitrary<SubArgs> {
  const forces: readonly PushForce[] = opts.forces ?? ['none', '--force', '-f', 'lease', 'lease=ref', 'lease+-f', 'lease+--force'];
  return fc
    .record({
      force: fc.constantFrom(...forces),
      upstream: fc.boolean(),
      tags: fc.boolean(),
      leaseRef: arbBranchName,
      positionals: fc.oneof(
        fc.constant<PushPositionals>({}),
        arbRemoteName.map((remote): PushPositionals => ({ remote })),
        fc.tuple(arbRemoteName, arbRefspec).map(([remote, refspec]): PushPositionals => ({ remote, refspec })),
      ),
    })
    .chain(({ force, upstream, tags, leaseRef, positionals }) => {
      const shorts: string[] = [];
      const units: string[][] = [];
      const shortF = force === '-f' || force === 'lease+-f';
      const longF = force === '--force' || force === 'lease+--force';
      const lease = force.startsWith('lease');
      if (shortF) shorts.push('f');
      if (longF) units.push(['--force']);
      if (lease) units.push([force === 'lease=ref' ? `--force-with-lease=${leaseRef}` : '--force-with-lease']);
      if (upstream) shorts.push('u');
      if (tags) units.push(['--tags']);
      const pos: string[] = [];
      if (positionals.remote) pos.push(positionals.remote);
      if (positionals.refspec) pos.push(positionals.refspec.refspec);
      const push: PushTarget = {
        remote: positionals.remote ?? REFERENCE_DEFAULT_REMOTE,
        branch: positionals.refspec?.branch ?? REFERENCE_BRANCH_PLACEHOLDER,
        remoteNamed: positionals.remote !== undefined,
        branchNamed: positionals.refspec !== undefined,
      };
      let risky: ExpectedRisky | null = null;
      if (shortF || longF) risky = expected('push_force', { push });
      else if (lease) risky = expected('push_force_with_lease', { push });
      return arbShortGroups(shorts).chain((groups) =>
        arbArrange([...units, ...groups], pos).map((args) => ({ kind: 'push' as const, subcommand: 'push', args, risky })),
      );
    });
}

type BranchMode = 'D' | 'd' | '--delete' | 'none' | 'list';

export interface BranchArgsOptions {
  /** Restrict the deletion mode; defaults to every mode. */
  modes?: readonly BranchMode[];
  /** Restrict the force option; defaults to none, `-f`, `--force`. */
  forces?: ReadonlyArray<string | null>;
}

export function arbBranchArgs(opts: BranchArgsOptions = {}): fc.Arbitrary<SubArgs> {
  const modes = opts.modes ?? (['D', 'd', '--delete', 'none', 'list'] as const);
  const forces = opts.forces ?? [null, '-f', '--force'];
  return fc
    .record({
      mode: fc.constantFrom(...modes),
      force: fc.constantFrom(...forces),
      names: fc.uniqueArray(arbBranchName, { minLength: 1, maxLength: 2 }),
      dropNames: fc.integer({ min: 0, max: 9 }),
    })
    .chain(({ mode, force, names, dropNames }) => {
      const shorts: string[] = [];
      const units: string[][] = [];
      if (mode === 'D') shorts.push('D');
      if (mode === 'd') shorts.push('d');
      if (mode === '--delete') units.push(['--delete']);
      if (mode === 'list') units.push(['--no-merged']);
      if (force === '-f') shorts.push('f');
      if (force === '--force') units.push(['--force']);
      let pos: string[];
      if (mode === 'list') pos = [];
      else if (mode === 'none') pos = [names[0], 'HEAD'];
      else pos = mode === 'D' && dropNames === 0 ? [] : names; // `git branch -D` with no names (rare)
      const forceDelete = mode === 'D' || ((mode === 'd' || mode === '--delete') && force !== null);
      const risky = forceDelete
        ? expected('branch_force_delete', { branchNames: pos.length > 0 ? [...pos] : [REFERENCE_BRANCH_PLACEHOLDER] })
        : null;
      return arbShortGroups(shorts).chain((groups) =>
        arbArrange([...units, ...groups], pos).map((args) => ({ kind: 'branch' as const, subcommand: 'branch', args, risky })),
      );
    });
}

// ---------------------------------------------------------------------------
// Non-risky subcommands
// ---------------------------------------------------------------------------

const arbStatusArgs: fc.Arbitrary<SubArgs> = fc
  .subarray(['-s', '--short', '-b', '--porcelain'])
  .chain((opts) => arbPermutation(opts))
  .map((args) => ({ kind: 'status' as const, subcommand: 'status', args, risky: null }));

const arbLogArgs: fc.Arbitrary<SubArgs> = fc
  .tuple(
    fc.subarray([['--oneline'], ['-n', '5'], ['--graph']]),
    fc.option(fc.oneof(arbBranchName, fc.tuple(arbRemoteName, arbBranchName).map(([r, b]) => `HEAD..${r}/${b}`)), { nil: undefined }),
  )
  .chain(([units, rev]) => arbArrange(units, rev ? [rev] : []))
  .map((args) => ({ kind: 'log' as const, subcommand: 'log', args, risky: null }));

const arbFetchArgs: fc.Arbitrary<SubArgs> = fc
  .tuple(fc.subarray([['--all'], ['--prune']]), fc.option(arbRemoteName, { nil: undefined }))
  .chain(([units, remote]) => arbArrange(units, remote ? [remote] : []))
  .map((args) => ({ kind: 'fetch' as const, subcommand: 'fetch', args, risky: null }));

/** `git commit` with messages that may look like options (`"--force"`), always non-risky. */
const arbCommitArgs: fc.Arbitrary<SubArgs> = fc
  .tuple(fc.constantFrom('-m', '-am', '--message', '--message='), arbCommitMessage, fc.subarray([['-q'], ['--all']]))
  .chain(([form, msg, extra]) => {
    const msgUnit = form === '--message=' ? [`--message=${msg}`] : [form, msg];
    return arbArrange([msgUnit, ...extra], []);
  })
  .map((args) => ({ kind: 'commit' as const, subcommand: 'commit', args, risky: null }));

const arbStashArgsSimple: fc.Arbitrary<SubArgs> = fc
  .constantFrom(['push', '-u'], [], ['pop'], ['list'], ['-um', 'wip'], ['push', '-m', 'fix --hard'])
  .map((args) => ({ kind: 'stash' as const, subcommand: 'stash', args: [...args], risky: null }));

export const arbNonRiskyArgs: fc.Arbitrary<SubArgs> = fc.oneof(
  arbStatusArgs,
  arbLogArgs,
  arbFetchArgs,
  arbCommitArgs,
  arbStashArgsSimple,
  // Non-risky forms of risky-capable subcommands.
  arbResetArgs.filter((a) => a.risky === null),
  arbCheckoutArgs.filter((a) => a.risky === null),
  arbCleanArgs({ force: 'noforce' }),
  arbPushArgs({ forces: ['none'] }),
  arbBranchArgs({ modes: ['d', '--delete', 'none', 'list'], forces: [null] }),
);

/** Any subcommand, risky or not. */
export const arbAnyArgs: fc.Arbitrary<SubArgs> = fc.oneof(
  arbResetArgs,
  arbCheckoutArgs,
  arbCleanArgs(),
  arbPushArgs(),
  arbBranchArgs(),
  arbNonRiskyArgs,
);

/** Risky subcommands only. */
export const arbRiskyArgs: fc.Arbitrary<SubArgs> = fc.oneof(
  arbResetArgs.filter((a) => a.risky !== null),
  arbCheckoutArgs.filter((a) => a.risky !== null),
  arbCleanArgs({ force: 'force' }),
  arbPushArgs({ forces: ['--force', '-f', 'lease', 'lease=ref', 'lease+-f', 'lease+--force'] }),
  arbBranchArgs({ modes: ['D', 'd', '--delete'], forces: ['-f', '--force'] }).filter((a) => a.risky !== null),
);

// ---------------------------------------------------------------------------
// Segments and full commands
// ---------------------------------------------------------------------------

/** Optional global options placed between `git` and the subcommand. */
export const arbGlobalOptions: fc.Arbitrary<string[]> = fc
  .tuple(
    fc.subarray([['--no-pager'], ['-P'], ['--git-dir=.git']]),
    fc.option(arbPath.map((p) => ['-C', p]), { nil: undefined }),
    fc.option(fc.constantFrom(['-c', 'core.pager=cat'], ['-c', 'user.name=dev']), { nil: undefined }),
  )
  .chain(([units, c, cfg]) => arbPermutation([...units, ...(c ? [c] : []), ...(cfg ? [cfg] : [])]))
  .map((units) => units.flat());

/** Wraps subcommand arguments into a full `git` segment with optional global options. */
export function arbSegmentFrom(args: fc.Arbitrary<SubArgs>, withGlobals = true): fc.Arbitrary<GitSegment> {
  return fc
    .tuple(args, withGlobals ? fc.oneof(fc.constant<string[]>([]), arbGlobalOptions) : fc.constant<string[]>([]))
    .map(([a, globals]) => ({ kind: a.kind, words: ['git', ...globals, a.subcommand, ...a.args], risky: a.risky }));
}

/** A non-Git segment that may mention risky Git words as arguments (never classified). */
export const arbNonGitSegment: fc.Arbitrary<GitSegment> = fc
  .tuple(fc.constantFrom('echo', 'cd', 'ls'), fc.array(fc.constantFrom('git', 'reset', '--hard', 'push', '-f', 'repo', 'done'), { maxLength: 4 }))
  .map(([cmd, rest]) => ({ kind: 'non_git' as const, words: [cmd, ...rest], risky: null }));

export const arbGitSegment: fc.Arbitrary<GitSegment> = fc.oneof(
  { weight: 6, arbitrary: arbSegmentFrom(arbAnyArgs) },
  { weight: 1, arbitrary: arbNonGitSegment },
);

export const arbSeparator: fc.Arbitrary<string> = fc.constantFrom(' && ', ' || ', '; ', ' ; ', ' | ', '\n');

/** Renders segments to one command string with random quoting and separators. */
export function arbRenderSegments(segments: readonly GitSegment[]): fc.Arbitrary<string> {
  if (segments.length === 0) return fc.constant('');
  return fc
    .tuple(
      fc.tuple(...segments.map((s) => arbRenderWords(s.words))),
      fc.array(arbSeparator, { minLength: segments.length - 1, maxLength: segments.length - 1 }),
    )
    .map(([rendered, seps]) => rendered.reduce((acc, text, i) => (i === 0 ? text : acc + seps[i - 1] + text), ''));
}

function toCommand(segments: GitSegment[]): fc.Arbitrary<GeneratedGitCommand> {
  return arbRenderSegments(segments).map((command) => ({
    command,
    segments,
    expected: segments.flatMap((s) => (s.risky ? [s.risky] : [])),
  }));
}

export interface GitCommandOptions {
  minSegments?: number;
  maxSegments?: number;
}

/** Full command (1..3 segments by default) with the reference classification. */
export function arbGitCommand(opts: GitCommandOptions = {}): fc.Arbitrary<GeneratedGitCommand> {
  const { minSegments = 1, maxSegments = 3 } = opts;
  return fc.array(arbGitSegment, { minLength: minSegments, maxLength: maxSegments }).chain(toCommand);
}

/** Single-segment command containing exactly one Risky_Command. */
export const arbRiskyGitCommand: fc.Arbitrary<GeneratedGitCommand> = arbSegmentFrom(arbRiskyArgs).chain((s) => toCommand([s]));

/** Command (1..2 segments) containing no Risky_Command. */
export const arbNonRiskyGitCommand: fc.Arbitrary<GeneratedGitCommand> = fc
  .array(fc.oneof(arbSegmentFrom(arbNonRiskyArgs), arbNonGitSegment), { minLength: 1, maxLength: 2 })
  .chain(toCommand);

/** Single-segment risky `git clean` command with its clean details (P22). */
export const arbCleanForceCommand: fc.Arbitrary<GeneratedGitCommand> = arbSegmentFrom(arbCleanArgs({ force: 'force' })).chain((s) =>
  toCommand([s]),
);

/** Single-segment risky `git push` command with its push target (P23). */
export const arbPushForceCommand: fc.Arbitrary<GeneratedGitCommand> = arbSegmentFrom(
  arbPushArgs({ forces: ['--force', '-f', 'lease', 'lease=ref', 'lease+-f', 'lease+--force'] }),
).chain((s) => toCommand([s]));

/** Single-segment branch force-delete command with its branch names (P24). */
export const arbBranchForceDeleteCommand: fc.Arbitrary<GeneratedGitCommand> = arbSegmentFrom(
  arbBranchArgs({ modes: ['D', 'd', '--delete'], forces: ['-f', '--force'] }),
).chain((s) => toCommand([s]));

// ---------------------------------------------------------------------------
// Reference safeguard sets (design: "Sets per operation")
// ---------------------------------------------------------------------------

/** Reference canonical dry-run command for a clean Risky_Command. */
export function referenceCleanDryRun(clean: CleanDetails): string {
  const flags = `-n${clean.d ? 'd' : ''}${clean.x ? 'x' : ''}${clean.X ? 'X' : ''}`;
  return `git clean ${flags}${clean.pathspecs.length > 0 ? ` -- ${clean.pathspecs.join(' ')}` : ''}`;
}

/**
 * Reference canonical Safeguard_Set commands for one Risky_Command, in order.
 * Generated identifiers are plain shell words, so no quoting is needed.
 */
export function referenceSafeguardCommands(risky: ExpectedRisky): string[] {
  switch (risky.operation) {
    case 'reset_hard':
    case 'checkout_force':
      return ['git status', 'git stash push -u'];
    case 'clean_force':
      return [referenceCleanDryRun(risky.clean!)];
    case 'push_force':
    case 'push_force_with_lease': {
      const { remote, branch } = risky.push!;
      return [`git fetch ${remote}`, `git log --oneline HEAD..${remote}/${branch}`];
    }
    case 'branch_force_delete':
      return [...risky.branchNames!.map((b) => `git log --oneline ${b}`), 'git branch --no-merged'];
  }
}

/** Reference Safeguard_Set for a whole command: concatenated sets in order of appearance. */
export function referenceRequiredSafeguards(cmd: GeneratedGitCommand): string[] {
  return cmd.expected.flatMap(referenceSafeguardCommands);
}
