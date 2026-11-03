// Feature: gitpulse-recovery-assistant, Property 12: Risky command classification matches the reference model
/**
 * **Validates: Requirements 11.1, 11.13, 12.1, 12.4, 13.1, 13.8, 14.1, 14.2, 15.1, 15.6**
 *
 * For any command generated from a grammar of Git invocations (shuffled
 * options, grouped short flags, quoting, global options, several segments),
 * `classifyCommand` returns exactly the Risky_Commands, in order of
 * appearance, that the reference rule table yields.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import type { RiskyCommand } from '../../src/lib/safety/riskClassifier';
import {
  arbBranchArgs,
  arbCleanArgs,
  arbCommitMessage,
  arbGitCommand,
  arbPushArgs,
  arbRenderSegments,
  arbSegmentFrom,
  type ExpectedRisky,
  type GeneratedGitCommand,
  type GitSegment,
} from '../arbitraries';

const RUNS = { numRuns: 200 };

/** Projects a classifier result onto the fields the reference model defines. */
function project(r: RiskyCommand): ExpectedRisky {
  const out: ExpectedRisky = { operation: r.operation, level: r.level };
  if (r.clean) out.clean = { d: r.clean.d, x: r.clean.x, X: r.clean.X, pathspecs: [...r.clean.pathspecs] };
  if (r.push) out.push = { ...r.push };
  if (r.branchNames) out.branchNames = [...r.branchNames];
  return out;
}

function classifyProjected(command: string): ExpectedRisky[] {
  return classifyCommand(command).map(project);
}

/** Renders one segment (with random quoting) into a full generated command. */
function single(seg: fc.Arbitrary<GitSegment>): fc.Arbitrary<GeneratedGitCommand> {
  return seg.chain((s) =>
    arbRenderSegments([s]).map((command) => ({ command, segments: [s], expected: s.risky ? [s.risky] : [] })),
  );
}

describe('Property 12: Risky command classification matches the reference model', () => {
  it('classifyCommand equals the reference classification for grammar-generated commands', () => {
    fc.assert(
      fc.property(arbGitCommand({ minSegments: 1, maxSegments: 4 }), (cmd) => {
        expect(classifyProjected(cmd.command)).toEqual(cmd.expected);
      }),
      RUNS,
    );
  });

  it('--force-with-lease alone is caution; adding --force or -f makes it destructive push_force', () => {
    const arb = single(arbSegmentFrom(arbPushArgs({ forces: ['lease', 'lease=ref', 'lease+-f', 'lease+--force', '--force', '-f'] })));
    fc.assert(
      fc.property(arb, (cmd) => {
        const got = classifyProjected(cmd.command);
        expect(got).toEqual(cmd.expected);
        expect(got).toHaveLength(1);
        const words = cmd.segments[0].words;
        const hasPlainForce = words.includes('--force') || words.some((w) => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(w));
        if (hasPlainForce) {
          expect(got[0]).toMatchObject({ operation: 'push_force', level: 'destructive' });
        } else {
          expect(got[0]).toMatchObject({ operation: 'push_force_with_lease', level: 'caution' });
        }
      }),
      RUNS,
    );
  });

  it('-D is a force delete; -d / --delete alone is not risky', () => {
    const arb = single(arbSegmentFrom(arbBranchArgs({ modes: ['D', 'd', '--delete'] })));
    fc.assert(
      fc.property(arb, (cmd) => {
        const got = classifyProjected(cmd.command);
        expect(got).toEqual(cmd.expected);
        const words = cmd.segments[0].words;
        const upperD = words.some((w) => /^-[a-zA-Z]*D[a-zA-Z]*$/.test(w));
        const force = words.includes('--force') || words.some((w) => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(w));
        if (upperD || force) {
          expect(got).toHaveLength(1);
          expect(got[0]).toMatchObject({ operation: 'branch_force_delete', level: 'destructive' });
        } else {
          expect(got).toEqual([]);
        }
      }),
      RUNS,
    );
  });

  it('git clean with -n and no -f is not risky; any -f/--force is destructive', () => {
    const arb = single(arbSegmentFrom(arbCleanArgs()));
    fc.assert(
      fc.property(arb, (cmd) => {
        const got = classifyProjected(cmd.command);
        expect(got).toEqual(cmd.expected);
        const words = cmd.segments[0].words;
        const subIdx = words.lastIndexOf('clean');
        const args = words.slice(subIdx + 1);
        const dashDash = args.indexOf('--');
        const opts = dashDash >= 0 ? args.slice(0, dashDash) : args;
        const force = opts.includes('--force') || opts.some((w) => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(w));
        if (force) {
          expect(got).toHaveLength(1);
          expect(got[0]).toMatchObject({ operation: 'clean_force', level: 'destructive' });
        } else {
          expect(got).toEqual([]);
        }
      }),
      RUNS,
    );
  });

  it('option-like commit messages are never classified as risky', () => {
    const arb = fc
      .tuple(fc.constantFrom('-m', '-am', '--message'), arbCommitMessage, fc.constantFrom<'single' | 'double'>('single', 'double'))
      .map(([flag, msg, style]) => {
        const quoted = style === 'single' ? `'${msg.replace(/'/g, `'\\''`)}'` : `"${msg.replace(/["\\$`]/g, (c) => `\\${c}`)}"`;
        return `git commit ${flag} ${quoted}`;
      });
    fc.assert(
      fc.property(arb, (command) => {
        expect(classifyCommand(command)).toEqual([]);
      }),
      RUNS,
    );
  });
});
