/**
 * Analyzer: selects an Analysis_Mode, produces an Analysis_Result, and passes
 * every result through the Safety_Validator before the Dashboard sees it
 * (Req 11.16).
 *
 * - No (valid `https:`) endpoint → Fallback_Engine, no `fallbackReason` (Req 19.2).
 * - Endpoint configured → POST `{ incidentText }` via `postIncident` (Req 19.1).
 *   Failures fall back to the Fallback_Engine with a `fallbackReason` (Req 9.5, 19.3).
 * - `analysisMode` is never rewritten; only an accepted Bedrock response
 *   carries `bedrock_ai` (Req 19.5, 19.6).
 * - Evidence cap: fewer than 2 `detectedEvidence` entries → never `high` (Req 10.6).
 * - If the Fallback_Engine or Safety_Validator throws, the promise rejects (Req 21.4).
 *
 * The Analyzer reads only the Incident_Text and calls only `fetchFn` with the
 * configured URL (Req 18.8, 18.9).
 */

import {
  RESIDUAL_RISK_LABEL,
  containsOverclaim,
  isAnalysisResult,
  type AnalysisResult,
  type FallbackReason,
  type RecoveryStep,
} from '../../shared/analysisContract';
import { config, parseEndpointUrl } from '../../config';
import { analyzeFallback } from '../fallback/fallbackEngine';
import { classifyCommand } from '../safety/riskClassifier';
import { validateSafety } from '../safety/safetyValidator';
import { postIncident, type BedrockClientResult } from './bedrockClient';

export interface AnalyzerDeps {
  endpointUrl?: string;
  fetchFn: typeof fetch;
  /** 15,000 ms in production (Req 19.3). */
  timeoutMs: number;
}

export interface AnalyzeOutcome {
  result: AnalysisResult;
  fallbackReason?: FallbackReason;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function isRiskyStep(step: RecoveryStep): boolean {
  return classifyCommand(step.command).length > 0;
}

/**
 * Returns the value as an Analysis_Result if it may be accepted as a Bedrock
 * result, otherwise `null` (Req 9.5). Pre-acceptance checks: strict contract,
 * `analysisMode === 'bedrock_ai'`, no Safety_Overclaim_Phrase in any Risky_Step
 * `title`/`explanation`/`warningMessage`, and no `warningMessage` containing
 * the Residual_Risk_Label more than once.
 */
export function acceptBedrockResult(value: unknown): AnalysisResult | null {
  if (!isAnalysisResult(value)) return null;
  if (value.analysisMode !== 'bedrock_ai') return null;
  for (const step of value.recoverySteps) {
    if (step.warningMessage !== undefined && countOccurrences(step.warningMessage, RESIDUAL_RISK_LABEL) > 1) {
      return null;
    }
    if (isRiskyStep(step)) {
      const texts = [step.title, step.explanation, step.warningMessage ?? ''];
      if (texts.some((text) => containsOverclaim(text))) return null;
    }
  }
  return value;
}

/** Caps confidence at `medium` when fewer than 2 evidence entries exist (Req 10.6). */
export function applyConfidenceCap(result: AnalysisResult): AnalysisResult {
  if (result.confidence === 'high' && result.detectedEvidence.length < 2) {
    return { ...result, confidence: 'medium' };
  }
  return result;
}

function finalize(result: AnalysisResult): AnalysisResult {
  return applyConfidenceCap(validateSafety(result));
}

function fallbackReasonFor(response: Exclude<BedrockClientResult, { kind: 'ok' }>): FallbackReason {
  switch (response.kind) {
    case 'error':
      return 'bedrock_error';
    case 'timeout':
      return 'bedrock_timeout';
    case 'invalid_json':
      return 'bedrock_invalid';
  }
}

function fallbackOutcome(text: string, fallbackReason?: FallbackReason): AnalyzeOutcome {
  const result = finalize(analyzeFallback(text));
  return fallbackReason === undefined ? { result } : { result, fallbackReason };
}

export async function analyze(text: string, deps: AnalyzerDeps): Promise<AnalyzeOutcome> {
  const endpointUrl = parseEndpointUrl(deps.endpointUrl);
  if (endpointUrl === undefined) {
    return fallbackOutcome(text);
  }

  const response = await postIncident(text, {
    endpointUrl,
    fetchFn: deps.fetchFn,
    timeoutMs: deps.timeoutMs,
  });

  if (response.kind !== 'ok') {
    return fallbackOutcome(text, fallbackReasonFor(response));
  }

  const accepted = acceptBedrockResult(response.body);
  if (accepted === null) {
    return fallbackOutcome(text, 'bedrock_invalid');
  }
  return { result: finalize(accepted) };
}

/** Production dependencies from `config.ts`; `fetch` is bound only when called. */
export function defaultAnalyzerDeps(): AnalyzerDeps {
  return {
    endpointUrl: config.bedrockEndpointUrl,
    fetchFn: globalThis.fetch.bind(globalThis),
    timeoutMs: config.bedrockTimeoutMs,
  };
}
