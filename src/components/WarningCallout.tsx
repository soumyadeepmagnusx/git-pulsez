/** Warning callout: rose for destructive, amber for caution (Req 11.17, 11.18). */

import { AlertTriangle } from 'lucide-react';
import type { RiskLevel } from '../shared/analysisContract';

export interface WarningCalloutProps {
  riskLevel: RiskLevel;
  warningMessage?: string;
}

const CALLOUT_CLASSES: Partial<Record<RiskLevel, string>> = {
  destructive: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
  caution: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
};

export function WarningCallout({ riskLevel, warningMessage }: WarningCalloutProps) {
  const classes = CALLOUT_CLASSES[riskLevel];
  if (!classes || !warningMessage) return null;
  return (
    <div
      data-testid="warning-callout"
      className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${classes}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{warningMessage}</p>
    </div>
  );
}
