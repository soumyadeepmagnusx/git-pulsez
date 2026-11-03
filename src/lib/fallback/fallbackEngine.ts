/**
 * Fallback_Engine (design: "Fallback_Engine").
 *
 * `analyzeFallback` is pure and synchronous. It selects the highest-priority
 * matched Incident_Type, extracts evidence that is an exact substring of the
 * Incident_Text, copies the playbook steps (numbered 1..n), and sets
 * `analysisMode` to `fallback_demo`. Safety validation is done by the Analyzer.
 */
import type {
  AnalysisResult,
  Confidence,
  IncidentType,
  RecoveryStep,
  SupportedIncidentType,
} from '../../shared/analysisContract';
import { dedupe, extractConflictPaths, extractRebaseOnto, extractReflogLines } from './extractors';
import { detectIncidentTypes, isTerminalOutput, triggerLines } from './patterns';
import { playbookFor, type PlaybookStep } from './playbooks';

export { detectIncidentTypes } from './patterns';

/** Assumption recorded for each additional matched type (Req 8.4). */
export function alsoMatchesAssumption(other: SupportedIncidentType, chosen: SupportedIncidentType): string {
  return `The text also matches ${other}; GitPulse chose ${chosen} using its fixed priority order.`;
}

/** Trigger lines plus type-specific entities, deduplicated (Req 4.2, 6.3, 7.3, 10.1). */
function evidenceFor(text: string, type: IncidentType): string[] {
  if (type === 'unknown') return [];
  const entries = triggerLines(text, type);
  switch (type) {
    case 'merge_conflict':
      entries.push(...extractConflictPaths(text).entries);
      break;
    case 'stuck_rebase':
      entries.push(...extractRebaseOnto(text).entries);
      break;
    case 'lost_commits':
      entries.push(...extractReflogLines(text));
      break;
    default:
      break;
  }
  return dedupe(entries);
}

/** Confidence rules (Req 8.1, 10.5, 10.6). */
function confidenceFor(type: IncidentType, text: string, evidenceCount: number): Confidence {
  if (type === 'unknown') return 'low';
  if (!isTerminalOutput(text)) return 'medium';
  if (evidenceCount < 2) return 'medium';
  return 'high';
}

/** Fresh Recovery_Step copy with only defined optional keys. */
function toStep(step: PlaybookStep, index: number): RecoveryStep {
  const out: RecoveryStep = {
    stepNumber: index + 1,
    title: step.title,
    explanation: step.explanation,
    command: step.command,
    riskLevel: step.riskLevel,
  };
  if (step.warningMessage !== undefined) out.warningMessage = step.warningMessage;
  if (step.backupPrerequisite !== undefined) out.backupPrerequisite = step.backupPrerequisite;
  return out;
}

export function analyzeFallback(text: string): AnalysisResult {
  const matched = detectIncidentTypes(text);
  const chosen: IncidentType = matched.length > 0 ? matched[0] : 'unknown';
  const playbook = playbookFor(chosen);

  const assumptions = [...playbook.assumptions];
  if (chosen !== 'unknown') {
    for (const other of matched.slice(1)) assumptions.push(alsoMatchesAssumption(other, chosen));
  }

  const detectedEvidence = evidenceFor(text, chosen);

  return {
    incidentType: chosen,
    title: playbook.title,
    confidence: confidenceFor(chosen, text, detectedEvidence.length),
    severity: playbook.severity,
    analysisMode: 'fallback_demo',
    summary: playbook.summary,
    detectedEvidence,
    assumptions,
    recoverySteps: playbook.steps.map(toStep),
  };
}
