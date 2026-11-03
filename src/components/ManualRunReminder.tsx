/** Manual-run reminder for caution/destructive steps (Req 18.7). */

import { Info } from 'lucide-react';
import type { RiskLevel } from '../shared/analysisContract';

export const MANUAL_RUN_REMINDER =
  'Review this command and its safeguard steps before you run it manually in a terminal.';

export interface ManualRunReminderProps {
  riskLevel: RiskLevel;
}

export function ManualRunReminder({ riskLevel }: ManualRunReminderProps) {
  if (riskLevel === 'safe') return null;
  return (
    <p data-testid="manual-run-reminder" className="flex items-start gap-2 text-xs text-slate-300">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {MANUAL_RUN_REMINDER}
    </p>
  );
}
