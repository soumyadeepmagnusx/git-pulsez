/**
 * Safety_Validator (design: "Validation algorithm").
 *
 * Pure, deterministic, and idempotent. For every original Recovery_Step in
 * order:
 * - Risky_Steps get `riskLevel = maxRisk(input, classified)`, the input warning
 *   kept as a prefix plus every missing command-specific text and the residual
 *   sentence, missing Safeguard_Steps inserted immediately before them, and a
 *   `backupPrerequisite` listing the full required Safeguard_Set.
 * - Destructive steps without a Risky_Command and without a warning get the
 *   generic destructive warning.
 * - All other steps are copied unchanged.
 * Finally, steps are renumbered 1..n.
 *
 * Requirements: 11.2–11.15, 11.20–11.22, 14.12
 */

import {
  type AnalysisResult,
  type RecoveryStep,
  type RiskLevel,
  RESIDUAL_RISK_LABEL,
  maxRisk,
} from '../../shared/analysisContract';
import { classifyCommand, type RiskyCommand } from './riskClassifier';
import { type SafeguardSpec, safeguardSetFor, windowSatisfies } from './safeguards';
import { GENERIC_DESTRUCTIVE_WARNING, RESIDUAL_RISK_SENTENCE, warningTextsFor } from './warnings';

/** Appends `text` with a single-space separator unless `message` already contains it. */
function appendIfMissing(message: string, text: string): string {
  if (message.includes(text)) return message;
  return message === '' ? text : `${message} ${text}`;
}

/** Input warning kept unchanged as a prefix, plus missing specific texts and the residual sentence once. */
export function buildRiskyWarning(input: string | undefined, risky: readonly RiskyCommand[]): string {
  let message = input ?? '';
  for (const command of risky) {
    for (const text of warningTextsFor(command)) {
      message = appendIfMissing(message, text);
    }
  }
  if (!message.includes(RESIDUAL_RISK_LABEL)) {
    message = appendIfMissing(message, RESIDUAL_RISK_SENTENCE);
  }
  return message;
}

/** Number of leading safeguards of `required` found as an ordered subsequence in `window`. */
export function matchedPrefixLength(window: readonly RecoveryStep[], required: readonly SafeguardSpec[]): number {
  let k = 0;
  for (const step of window) {
    if (k >= required.length) break;
    if (windowSatisfies(step.command, required[k])) {
      k += 1;
    }
  }
  return k;
}

function copyStep(step: RecoveryStep): RecoveryStep {
  return { ...step };
}

function insertedStep(spec: SafeguardSpec): RecoveryStep {
  return {
    stepNumber: 0, // renumbered at the end
    title: spec.title,
    explanation: spec.explanation,
    command: spec.command,
    riskLevel: 'safe',
  };
}

function highestLevel(risky: readonly RiskyCommand[]): RiskLevel {
  return risky.reduce<RiskLevel>((level, command) => maxRisk(level, command.level), 'safe');
}

/** Validates one Analysis_Result. Never mutates the input. */
export function validateSafety(result: AnalysisResult): AnalysisResult {
  const output: RecoveryStep[] = [];
  // Index in `output` where the current Safeguard_Window starts.
  let windowStart = 0;

  for (const original of result.recoverySteps) {
    const risky = classifyCommand(original.command);

    if (risky.length === 0) {
      const step = copyStep(original);
      if (step.riskLevel === 'destructive' && !step.warningMessage) {
        step.warningMessage = GENERIC_DESTRUCTIVE_WARNING;
      }
      output.push(step);
      continue;
    }

    const required = risky.flatMap((command) => safeguardSetFor(command));
    const k = matchedPrefixLength(output.slice(windowStart), required);
    for (const spec of required.slice(k)) {
      output.push(insertedStep(spec));
    }

    const step = copyStep(original);
    step.riskLevel = maxRisk(original.riskLevel, highestLevel(risky));
    step.warningMessage = buildRiskyWarning(original.warningMessage, risky);
    step.backupPrerequisite = required.map((spec) => spec.command).join(' then ');
    output.push(step);
    windowStart = output.length;
  }

  return {
    ...result,
    detectedEvidence: [...result.detectedEvidence],
    assumptions: [...result.assumptions],
    recoverySteps: output.map((step, index) => ({ ...step, stepNumber: index + 1 })),
  };
}
