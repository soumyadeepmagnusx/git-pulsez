/** Analysis_Result header: title, summary, type, severity, confidence, Mode_Badge (Req 10.7, 17.1). */

import { Activity } from 'lucide-react';
import type { AnalysisResult, IncidentType, Severity } from '../shared/analysisContract';
import { ModeBadge } from './ModeBadge';

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  rejected_push: 'Rejected push',
  merge_conflict: 'Merge conflict',
  detached_head: 'Detached HEAD',
  stuck_rebase: 'Stuck rebase',
  lost_commits: 'Lost commits',
  unknown: 'Unknown incident',
};

export const LIKELY_DIAGNOSIS_TEXT = 'Likely diagnosis, not certain';

const SEVERITY_CLASSES: Record<Severity, string> = {
  low: 'text-emerald-300',
  medium: 'text-amber-300',
  high: 'text-rose-300',
};

export interface AnalysisHeaderProps {
  result: AnalysisResult;
}

export function AnalysisHeader({ result }: AnalysisHeaderProps) {
  return (
    <header className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ModeBadge mode={result.analysisMode} />
      </div>
      <h2 className="flex items-start gap-2 text-xl font-semibold text-slate-100">
        <Activity className="mt-1 h-5 w-5 shrink-0 text-violet-400" aria-hidden="true" />
        <span>{result.title}</span>
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">{result.summary}</p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-300">Incident type</dt>
          <dd className="text-slate-100">
            {INCIDENT_TYPE_LABELS[result.incidentType]}{' '}
            <code className="font-mono text-xs text-cyan-300">({result.incidentType})</code>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-300">Severity</dt>
          <dd className={`font-medium ${SEVERITY_CLASSES[result.severity]}`}>{result.severity}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-300">Diagnosis</dt>
          <dd className="text-slate-100">
            <span className="font-medium">Confidence: {result.confidence}</span>
            <span className="block text-xs text-slate-300">{LIKELY_DIAGNOSIS_TEXT}</span>
          </dd>
        </div>
      </dl>
    </header>
  );
}
