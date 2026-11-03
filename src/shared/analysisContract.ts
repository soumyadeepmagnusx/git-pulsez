/**
 * Shared Analysis_Result contract between the Analyzer, the Dashboard, and the
 * optional Bedrock_Handler. This module has zero dependencies so `backend/`
 * can inline it with esbuild; the frontend never imports from `backend/`.
 */

export const SUPPORTED_INCIDENT_TYPES = [
  'rejected_push',
  'merge_conflict',
  'detached_head',
  'stuck_rebase',
  'lost_commits',
] as const;
export type SupportedIncidentType = (typeof SUPPORTED_INCIDENT_TYPES)[number];
export type IncidentType = SupportedIncidentType | 'unknown';

export const INCIDENT_TYPES: readonly IncidentType[] = [...SUPPORTED_INCIDENT_TYPES, 'unknown'];

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const SEVERITIES = ['low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ANALYSIS_MODES = ['bedrock_ai', 'fallback_demo'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export const RISK_LEVELS = ['safe', 'caution', 'destructive'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_ORDER: Record<RiskLevel, number> = { safe: 0, caution: 1, destructive: 2 };

export const MAX_INCIDENT_CHARS = 20_000;

export const RESIDUAL_RISK_LABEL = 'Risk remains after safeguards';

export const SAFETY_OVERCLAIM_PHRASES: readonly string[] = [
  'now safe',
  'makes it safe',
  'safe to run',
  'completely safe',
  'guarantees safety',
  'fully protected',
];

export const FALLBACK_REASONS = ['bedrock_error', 'bedrock_invalid', 'bedrock_timeout'] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export interface RecoveryStep {
  stepNumber: number;
  title: string;
  explanation: string;
  command: string;
  riskLevel: RiskLevel;
  warningMessage?: string;
  backupPrerequisite?: string;
}

export interface AnalysisResult {
  incidentType: IncidentType;
  title: string;
  confidence: Confidence;
  severity: Severity;
  analysisMode: AnalysisMode;
  summary: string;
  detectedEvidence: string[];
  assumptions: string[];
  recoverySteps: RecoveryStep[];
}

export interface HistoryEntry {
  id: string;
  incidentText: string;
  result: AnalysisResult;
  /** Epoch milliseconds. */
  createdAt: number;
  fallbackReason?: FallbackReason;
}

export interface StoredHistory {
  version: 1;
  entries: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(obj: PlainObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** True when every own key is in `required` or `optional`, and every required key is present. */
function hasExactKeys(obj: PlainObject, required: readonly string[], optional: readonly string[]): boolean {
  for (const key of required) {
    if (!hasOwn(obj, key)) return false;
  }
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) return false;
  }
  return true;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Optional key: either absent, or present with a string value (`undefined` is rejected). */
function isOptionalString(obj: PlainObject, key: string): boolean {
  return !hasOwn(obj, key) || typeof obj[key] === 'string';
}

const STEP_REQUIRED_KEYS = ['stepNumber', 'title', 'explanation', 'command', 'riskLevel'] as const;
const STEP_OPTIONAL_KEYS = ['warningMessage', 'backupPrerequisite'] as const;

function isRecoveryStep(value: unknown, expectedNumber: number): value is RecoveryStep {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, STEP_REQUIRED_KEYS, STEP_OPTIONAL_KEYS)) return false;
  return (
    typeof value.stepNumber === 'number' &&
    Number.isInteger(value.stepNumber) &&
    value.stepNumber === expectedNumber &&
    typeof value.title === 'string' &&
    typeof value.explanation === 'string' &&
    typeof value.command === 'string' &&
    isOneOf(value.riskLevel, RISK_LEVELS) &&
    isOptionalString(value, 'warningMessage') &&
    isOptionalString(value, 'backupPrerequisite')
  );
}

const RESULT_KEYS = [
  'incidentType',
  'title',
  'confidence',
  'severity',
  'analysisMode',
  'summary',
  'detectedEvidence',
  'assumptions',
  'recoverySteps',
] as const;

/**
 * Strict Analysis_Result validator (Req 9.1–9.4): enum checks, string types,
 * at least one step, `stepNumber` = 1..n in array order, no unknown keys.
 */
export function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, RESULT_KEYS, [])) return false;
  if (!isOneOf(value.incidentType, INCIDENT_TYPES)) return false;
  if (typeof value.title !== 'string') return false;
  if (!isOneOf(value.confidence, CONFIDENCES)) return false;
  if (!isOneOf(value.severity, SEVERITIES)) return false;
  if (!isOneOf(value.analysisMode, ANALYSIS_MODES)) return false;
  if (typeof value.summary !== 'string') return false;
  if (!isStringArray(value.detectedEvidence)) return false;
  if (!isStringArray(value.assumptions)) return false;
  const steps = value.recoverySteps;
  if (!Array.isArray(steps) || steps.length < 1) return false;
  return steps.every((step, index) => isRecoveryStep(step, index + 1));
}

const HISTORY_REQUIRED_KEYS = ['id', 'incidentText', 'result', 'createdAt'] as const;
const HISTORY_OPTIONAL_KEYS = ['fallbackReason'] as const;

/** Strict History_Entry validator: string id/incidentText, finite createdAt, valid result. */
export function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, HISTORY_REQUIRED_KEYS, HISTORY_OPTIONAL_KEYS)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.incidentText !== 'string') return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
  if (hasOwn(value, 'fallbackReason') && !isOneOf(value.fallbackReason, FALLBACK_REASONS)) return false;
  return isAnalysisResult(value.result);
}

/** Case-insensitive check for any Safety_Overclaim_Phrase (Req 11.22). */
export function containsOverclaim(text: string): boolean {
  const lower = text.toLowerCase();
  return SAFETY_OVERCLAIM_PHRASES.some((phrase) => lower.includes(phrase));
}

/** The more severe of two Risk_Levels (`safe` < `caution` < `destructive`). */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[b] > RISK_ORDER[a] ? b : a;
}
