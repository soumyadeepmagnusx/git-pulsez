/**
 * Recovery_Step and Analysis_Result arbitraries.
 *
 * Results are valid contract values (`isAnalysisResult` passes) in either
 * Analysis_Mode. Steps are built from "blocks": a random partial
 * Safeguard_Window (some of the required safeguards, canonical or accepted
 * variants, in order, mixed with distractor steps that satisfy no
 * safeguard) followed by a Risky_Step. Results may also contain blocks with
 * no Risky_Step. `arbAnalysisResultWithMeta` exposes the block structure.
 */

import fc from 'fast-check';
import {
  ANALYSIS_MODES,
  CONFIDENCES,
  INCIDENT_TYPES,
  RISK_LEVELS,
  SEVERITIES,
  type AnalysisMode,
  type AnalysisResult,
  type RecoveryStep,
} from '../../src/shared/analysisContract';
import {
  type ExpectedRisky,
  type GeneratedGitCommand,
  arbGitCommand,
  arbNonRiskyGitCommand,
  arbPermutation,
  arbRiskyGitCommand,
  arbShortGroups,
  referenceSafeguardCommands,
} from './gitCommand';
import { arbAcceptedStashCommand, arbRejectedStashCommand } from './stashCommand';
import { type WarningTextOptions, arbSafeText, arbSimpleName, arbWarningText } from './text';

export type StepBody = Omit<RecoveryStep, 'stepNumber'>;

// ---------------------------------------------------------------------------
// Commands for window steps
// ---------------------------------------------------------------------------

/** Commands that satisfy no safeguard of any Risky_Command. */
export const arbDistractorCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('git diff', 'git show HEAD', 'echo checking', 'git add .', 'git remote -v', 'git commit -m "wip"', 'git commit -am wip'),
  arbRejectedStashCommand.map((c) => c.command),
);

/**
 * A command that satisfies the safeguard whose canonical command is
 * `canonical` (for the Risky_Command `risky`): the canonical form itself or an
 * accepted variant.
 */
export function arbSafeguardVariant(canonical: string, risky: ExpectedRisky): fc.Arbitrary<string> {
  const variants: Array<fc.Arbitrary<string>> = [fc.constant(canonical)];
  if (canonical === 'git status') {
    variants.push(fc.constantFrom('git status -s', 'git status --short'));
  } else if (canonical === 'git stash push -u') {
    variants.push(arbAcceptedStashCommand.map((c) => c.command));
  } else if (canonical.startsWith('git clean ') && risky.clean) {
    const { d, x, X, pathspecs } = risky.clean;
    const shorts = [...(d ? ['d'] : []), ...(x ? ['x'] : []), ...(X ? ['X'] : [])];
    variants.push(
      fc
        .tuple(fc.constantFrom('n', '--dry-run'), fc.boolean())
        .chain(([dry, dashDash]) => {
          const flags = dry === 'n' ? [...shorts, 'n'] : shorts;
          return arbShortGroups(flags).chain((groups) => {
            const units = dry === 'n' ? groups : [...groups, ['--dry-run']];
            return arbPermutation(units).map((perm) => {
              const paths = pathspecs.length === 0 ? [] : dashDash ? ['--', ...pathspecs] : pathspecs;
              return ['git', 'clean', ...perm.flat(), ...paths].join(' ');
            });
          });
        }),
    );
  } else if (canonical.startsWith('git fetch')) {
    variants.push(fc.constantFrom('git fetch', 'git fetch --all', 'git fetch --prune'));
  } else if (canonical.startsWith('git log --oneline HEAD..') && risky.push) {
    const { remote, branch, branchNamed } = risky.push;
    const branchArb = branchNamed ? fc.constant(branch) : arbSimpleName;
    variants.push(branchArb.map((b) => `git log HEAD..${remote}/${b} -n 20`));
  } else if (canonical.startsWith('git log --oneline ')) {
    const name = canonical.slice('git log --oneline '.length);
    variants.push(fc.constantFrom(`git log ${name} -n 3`, `git log --graph ${name}`));
  } else if (canonical === 'git branch --no-merged') {
    variants.push(fc.constantFrom('git branch --no-merged main', 'git branch --no-merged=main'));
  }
  return fc.oneof(...variants);
}

// ---------------------------------------------------------------------------
// Step bodies
// ---------------------------------------------------------------------------

export interface StepOptions {
  warnings?: WarningTextOptions;
}

/** A Recovery_Step body for `command`, with random risk level and optional keys (absent, never `undefined`). */
export function arbStepBodyFor(command: string, opts: StepOptions = {}): fc.Arbitrary<StepBody> {
  return fc
    .record({
      title: arbSafeText({ maxWords: 4 }),
      explanation: arbSafeText({ maxWords: 10 }),
      riskLevel: fc.constantFrom(...RISK_LEVELS),
      warningMessage: fc.option(arbWarningText(opts.warnings), { nil: undefined }),
      backupPrerequisite: fc.option(arbSafeText({ maxWords: 4 }), { nil: undefined }),
    })
    .map(({ warningMessage, backupPrerequisite, ...rest }) => {
      const step: StepBody = { ...rest, command };
      if (warningMessage !== undefined) step.warningMessage = warningMessage;
      if (backupPrerequisite !== undefined) step.backupPrerequisite = backupPrerequisite;
      return step;
    });
}

/** A single Recovery_Step (stepNumber 1) whose command may or may not be risky. */
export function arbRecoveryStep(opts: StepOptions = {}): fc.Arbitrary<RecoveryStep> {
  return fc
    .oneof(arbGitCommand(), arbRiskyGitCommand)
    .chain((cmd) => arbStepBodyFor(cmd.command, opts))
    .map((body) => ({ stepNumber: 1, ...body }));
}

// ---------------------------------------------------------------------------
// Blocks and results
// ---------------------------------------------------------------------------

export interface GeneratedBlock {
  /** Step bodies of this block, in order (window steps, then the Risky_Step if any). */
  steps: StepBody[];
  /** The Risky_Step's generated command, or `null` for a block without one. */
  risky: GeneratedGitCommand | null;
  /** Reference canonical commands of the full required Safeguard_Set. */
  required: string[];
  /**
   * Indices into `required` that this block's window deliberately includes
   * (in order). Steps of an earlier plain block in the same window may also
   * satisfy safeguards, so property tests should compute the actual window
   * prefix from the result itself.
   */
  includedSafeguards: number[];
}

export interface BlockOptions extends StepOptions {
  /** Allow multi-segment Risky_Steps (concatenated Safeguard_Sets). Default true. */
  multiSegment?: boolean;
}

function arbRiskyCommandForBlock(multiSegment: boolean): fc.Arbitrary<GeneratedGitCommand> {
  if (!multiSegment) return arbRiskyGitCommand;
  return fc.oneof(
    { weight: 3, arbitrary: arbRiskyGitCommand },
    { weight: 1, arbitrary: arbGitCommand({ minSegments: 2, maxSegments: 3 }).filter((c) => c.expected.length > 0) },
  );
}

/** A random partial Safeguard_Window followed by a Risky_Step. */
export function arbRiskyBlock(opts: BlockOptions = {}): fc.Arbitrary<GeneratedBlock> {
  return arbRiskyCommandForBlock(opts.multiSegment ?? true).chain((risky) => {
    const required = risky.expected.flatMap(referenceSafeguardCommands);
    const owners = risky.expected.flatMap((e) => referenceSafeguardCommands(e).map(() => e));
    return fc
      .tuple(
        fc.array(fc.boolean(), { minLength: required.length, maxLength: required.length }),
        fc.tuple(...required.map((c, i) => arbSafeguardVariant(c, owners[i]))),
        fc.array(fc.option(arbDistractorCommand, { nil: undefined, freq: 3 }), {
          minLength: required.length + 1,
          maxLength: required.length + 1,
        }),
      )
      .chain(([include, variants, distractors]) => {
        const included = include.flatMap((inc, i) => (inc ? [i] : []));
        const windowCommands: string[] = [];
        required.forEach((_, i) => {
          if (distractors[i] !== undefined) windowCommands.push(distractors[i]!);
          if (include[i]) windowCommands.push(variants[i]);
        });
        if (distractors[required.length] !== undefined) windowCommands.push(distractors[required.length]!);
        const bodies = [...windowCommands, risky.command].map((c) => arbStepBodyFor(c, opts));
        return fc.tuple(...bodies).map((steps) => ({ steps, risky, required, includedSafeguards: included }));
      });
  });
}

/** 1..3 non-risky steps (no Risky_Command). */
export function arbPlainBlock(opts: StepOptions = {}): fc.Arbitrary<GeneratedBlock> {
  return fc
    .array(fc.oneof(arbNonRiskyGitCommand.map((c) => c.command), arbDistractorCommand), { minLength: 1, maxLength: 3 })
    .chain((cmds) => fc.tuple(...cmds.map((c) => arbStepBodyFor(c, opts))))
    .map((steps) => ({ steps, risky: null, required: [], includedSafeguards: [] }));
}

export interface AnalysisResultOptions extends BlockOptions {
  /** Fix the Analysis_Mode; defaults to either mode. */
  mode?: AnalysisMode;
  /** Maximum number of blocks (default 3). */
  maxBlocks?: number;
  /** Include risky blocks (default true). */
  includeRisky?: boolean;
}

export interface GeneratedAnalysisResult {
  result: AnalysisResult;
  blocks: GeneratedBlock[];
}

/** Valid Analysis_Result plus its block structure. */
export function arbAnalysisResultWithMeta(opts: AnalysisResultOptions = {}): fc.Arbitrary<GeneratedAnalysisResult> {
  const block =
    opts.includeRisky === false
      ? arbPlainBlock(opts)
      : fc.oneof({ weight: 3, arbitrary: arbRiskyBlock(opts) }, { weight: 1, arbitrary: arbPlainBlock(opts) });
  return fc
    .record({
      blocks: fc.array(block, { minLength: 1, maxLength: opts.maxBlocks ?? 3 }),
      incidentType: fc.constantFrom(...INCIDENT_TYPES),
      title: arbSafeText({ maxWords: 5 }),
      confidence: fc.constantFrom(...CONFIDENCES),
      severity: fc.constantFrom(...SEVERITIES),
      analysisMode: opts.mode ? fc.constant(opts.mode) : fc.constantFrom(...ANALYSIS_MODES),
      summary: arbSafeText({ maxWords: 12 }),
      detectedEvidence: fc.array(arbSafeText({ maxWords: 6 }), { maxLength: 4 }),
      assumptions: fc.array(arbSafeText({ maxWords: 6 }), { maxLength: 3 }),
    })
    .map(({ blocks, ...fields }) => ({
      blocks,
      result: {
        incidentType: fields.incidentType,
        title: fields.title,
        confidence: fields.confidence,
        severity: fields.severity,
        analysisMode: fields.analysisMode,
        summary: fields.summary,
        detectedEvidence: fields.detectedEvidence,
        assumptions: fields.assumptions,
        recoverySteps: blocks.flatMap((b) => b.steps).map((s, i) => ({ stepNumber: i + 1, ...s })),
      },
    }));
}

/** Valid Analysis_Result in either (or the given) Analysis_Mode. */
export function arbAnalysisResult(opts: AnalysisResultOptions = {}): fc.Arbitrary<AnalysisResult> {
  return arbAnalysisResultWithMeta(opts).map((g) => g.result);
}
