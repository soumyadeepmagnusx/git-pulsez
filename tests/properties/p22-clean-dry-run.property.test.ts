// Feature: gitpulse-recovery-assistant, Property 22: Clean dry-run safeguard matches the destructive command
/**
 * For any `git clean` Destructive_Command with any combination of `d`, `x`,
 * `X` flags, option grouping, and pathspecs, the generated dry-run command
 * contains `-n`, no `-f`, the same `d`/`x`/`X` set and the same pathspecs, and
 * is accepted by the `clean_dry_run` matcher; and for any `git clean` command
 * that differs in its `d`/`x`/`X` set or pathspecs, or contains `-f`/`--force`,
 * or lacks `-n`/`--dry-run`, the matcher rejects it.
 *
 * **Validates: Requirements 13.5, 13.6**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnalysisMode, AnalysisResult, RecoveryStep, RiskLevel } from '../../src/shared/analysisContract';
import type { CleanDetails } from '../../src/lib/safety/riskTypes';
import { parseGitInvocations } from '../../src/lib/safety/gitCommandParser';
import { cleanDryRunSpec } from '../../src/lib/safety/safeguards';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import {
  type GeneratedGitCommand,
  arbCleanForceCommand,
  arbPath,
  arbPermutation,
  arbShortGroups,
  referenceCleanDryRun,
} from '../arbitraries';

const RUNS = { numRuns: 200 };

const arbMode = fc.constantFrom<AnalysisMode>('fallback_demo', 'bedrock_ai');
const arbRisk = fc.constantFrom<RiskLevel>('safe', 'caution', 'destructive');

function step(n: number, command: string, riskLevel: RiskLevel): RecoveryStep {
  return { stepNumber: n, title: `Step ${n}`, explanation: `Run ${command}`, command, riskLevel };
}

function buildResult(windowCommands: string[], risky: string, riskyLevel: RiskLevel, mode: AnalysisMode): AnalysisResult {
  const commands = [...windowCommands, risky];
  return {
    incidentType: 'unknown',
    title: 'Test',
    confidence: 'low',
    severity: 'low',
    analysisMode: mode,
    summary: 'Test result',
    detectedEvidence: [],
    assumptions: [],
    recoverySteps: commands.map((c, i) => step(i + 1, c, i === commands.length - 1 ? riskyLevel : 'safe')),
  };
}

function cleanOf(cmd: GeneratedGitCommand): CleanDetails {
  return cmd.expected[0].clean!;
}

// ---------------------------------------------------------------------------
// Window `git clean` candidates with a reference matcher verdict
// ---------------------------------------------------------------------------

interface CleanSpec {
  dry: 'n' | '--dry-run' | null;
  force: 'f' | '--force' | null;
  d: boolean;
  x: boolean;
  X: boolean;
  pathspecs: string[];
}

/** Reference verdict of the `clean_dry_run` matcher (design: Matchers table). */
function referenceAccepts(spec: CleanSpec, target: CleanDetails): boolean {
  const sameSet = (a: string[], b: string[]) => new Set(a).size === new Set(b).size && a.every((p) => b.includes(p));
  return (
    spec.dry !== null &&
    spec.force === null &&
    spec.d === target.d &&
    spec.x === target.x &&
    spec.X === target.X &&
    sameSet(spec.pathspecs, target.pathspecs)
  );
}

/** Renders a `git clean` command for `spec` with random grouping, ordering, and `--` placement. */
function arbRenderClean(spec: CleanSpec): fc.Arbitrary<string> {
  const shorts = [
    ...(spec.dry === 'n' ? ['n'] : []),
    ...(spec.force === 'f' ? ['f'] : []),
    ...(spec.d ? ['d'] : []),
    ...(spec.x ? ['x'] : []),
    ...(spec.X ? ['X'] : []),
  ];
  const longs: string[][] = [
    ...(spec.dry === '--dry-run' ? [['--dry-run']] : []),
    ...(spec.force === '--force' ? [['--force']] : []),
  ];
  return fc
    .tuple(arbShortGroups(shorts), fc.boolean(), arbPermutation(spec.pathspecs))
    .chain(([groups, dashDash, paths]) =>
      arbPermutation([...groups, ...longs]).map((units) => {
        const tail = paths.length === 0 ? [] : dashDash ? ['--', ...paths] : paths;
        return ['git', 'clean', ...units.flat(), ...tail].join(' ');
      }),
    );
}

/** A dry run equivalent to the canonical one (any order, grouping, `-n` or `--dry-run`). */
function arbMatchingSpec(target: CleanDetails): fc.Arbitrary<CleanSpec> {
  return fc.constantFrom<'n' | '--dry-run'>('n', '--dry-run').map((dry) => ({
    dry,
    force: null,
    d: target.d,
    x: target.x,
    X: target.X,
    pathspecs: [...target.pathspecs],
  }));
}

type Mutation = 'toggle_d' | 'toggle_x' | 'toggle_X' | 'add_path' | 'drop_path' | 'swap_path' | 'add_force' | 'drop_dry';

/** A `git clean` command that differs from the canonical dry run in at least one matcher-relevant way. */
function arbMismatchingSpec(target: CleanDetails): fc.Arbitrary<CleanSpec> {
  const mutations: Mutation[] = ['toggle_d', 'toggle_x', 'toggle_X', 'add_path', 'add_force', 'drop_dry'];
  if (target.pathspecs.length > 0) mutations.push('drop_path', 'swap_path');
  const arbNewPath = arbPath.filter((p) => !target.pathspecs.includes(p));
  return fc
    .tuple(
      arbMatchingSpec(target),
      fc.uniqueArray(fc.constantFrom(...mutations), { minLength: 1, maxLength: 3 }),
      arbNewPath,
      fc.constantFrom<'f' | '--force'>('f', '--force'),
      fc.nat(),
    )
    .map(([base, muts, newPath, force, idx]) => {
      const spec: CleanSpec = { ...base, pathspecs: [...base.pathspecs] };
      for (const m of muts) {
        if (m === 'toggle_d') spec.d = !spec.d;
        if (m === 'toggle_x') spec.x = !spec.x;
        if (m === 'toggle_X') spec.X = !spec.X;
        if (m === 'add_force') spec.force = force;
        if (m === 'drop_dry') spec.dry = null;
        if (m === 'add_path' && !spec.pathspecs.includes(newPath)) spec.pathspecs.push(newPath);
        if (m === 'drop_path' && spec.pathspecs.length > 0) spec.pathspecs.splice(idx % spec.pathspecs.length, 1);
        if (m === 'swap_path' && spec.pathspecs.length > 0 && !spec.pathspecs.includes(newPath)) {
          spec.pathspecs[idx % spec.pathspecs.length] = newPath;
        }
      }
      return spec;
    })
    .filter((spec) => !referenceAccepts(spec, target)); // mutations can cancel out (e.g. drop then add)
}

describe('Property 22: Clean dry-run safeguard matches the destructive command', () => {
  it('with no window, exactly the canonical dry run is inserted, and it has -n, no -f, the same d/x/X set and pathspecs, and satisfies the matcher', () => {
    fc.assert(
      fc.property(arbCleanForceCommand, arbRisk, arbMode, (risky, level, mode) => {
        const clean = cleanOf(risky);
        const canonical = referenceCleanDryRun(clean);

        const output = validateSafety(buildResult([], risky.command, level, mode));
        expect(output.recoverySteps.map((s) => s.command)).toEqual([canonical, risky.command]);
        expect(output.recoverySteps[0].riskLevel).toBe('safe');
        expect(output.recoverySteps[1].riskLevel).toBe('destructive');
        expect(output.recoverySteps[1].backupPrerequisite).toBe(canonical);
        expect(cleanDryRunSpec(clean).command).toBe(canonical);

        const invs = parseGitInvocations(canonical);
        expect(invs).toHaveLength(1);
        const inv = invs[0];
        expect(inv.subcommand).toBe('clean');
        expect(inv.shortFlags).toContain('n');
        expect(inv.shortFlags).not.toContain('f');
        expect(inv.longOpts.has('--force')).toBe(false);
        expect(inv.shortFlags.includes('d')).toBe(clean.d);
        expect(inv.shortFlags.includes('x')).toBe(clean.x);
        expect(inv.shortFlags.includes('X')).toBe(clean.X);
        // `positionals` already includes the words after `--`.
        expect([...inv.positionals].sort()).toEqual([...clean.pathspecs].sort());
        expect(cleanDryRunSpec(clean).matches(inv)).toBe(true);
      }),
      RUNS,
    );
  });

  it('a window dry run with -n/--dry-run, no force, the same d/x/X set and pathspec set (any order/grouping) satisfies the safeguard: nothing is inserted', () => {
    fc.assert(
      fc.property(
        arbCleanForceCommand.chain((risky) =>
          arbMatchingSpec(cleanOf(risky)).chain((spec) => arbRenderClean(spec).map((cmd) => ({ risky, cmd }))),
        ),
        arbRisk,
        arbMode,
        ({ risky, cmd }, level, mode) => {
          const clean = cleanOf(risky);
          const invs = parseGitInvocations(cmd);
          expect(invs).toHaveLength(1);
          expect(cleanDryRunSpec(clean).matches(invs[0])).toBe(true);

          const output = validateSafety(buildResult([cmd], risky.command, level, mode));
          expect(output.recoverySteps.map((s) => s.command)).toEqual([cmd, risky.command]);
        },
      ),
      RUNS,
    );
  });

  it('a window clean command that differs in d/x/X, pathspecs, contains force, or lacks a dry-run option is rejected: the canonical dry run is inserted immediately before the risky step', () => {
    fc.assert(
      fc.property(
        arbCleanForceCommand.chain((risky) =>
          arbMismatchingSpec(cleanOf(risky)).chain((spec) => arbRenderClean(spec).map((cmd) => ({ risky, spec, cmd }))),
        ),
        arbRisk,
        arbMode,
        ({ risky, spec, cmd }, level, mode) => {
          const clean = cleanOf(risky);
          const canonical = referenceCleanDryRun(clean);
          const invs = parseGitInvocations(cmd);
          expect(invs).toHaveLength(1);
          expect(cleanDryRunSpec(clean).matches(invs[0])).toBe(false);

          const output = validateSafety(buildResult([cmd], risky.command, level, mode));
          const commands = output.recoverySteps.map((s) => s.command);
          // A window command containing force is itself a Risky_Step and may get its
          // own safeguard inserted before it; the final risky step's window then starts
          // after it, so the canonical dry run must still precede the final risky step.
          expect(commands.slice(-2)).toEqual([canonical, risky.command]);
          expect(commands.slice(-3, -2)).toEqual([cmd]);
          if (spec.force === null) expect(commands).toEqual([cmd, canonical, risky.command]);
          expect(output.recoverySteps[commands.length - 2].riskLevel).toBe('safe');
        },
      ),
      RUNS,
    );
  });
});
