/** Risk_Badge: text label equal to the Risk_Level plus a matching color (Req 17.4, 22.7, 11.23). */

import type { RiskLevel } from '../shared/analysisContract';

export const RISK_BADGE_CLASSES: Record<RiskLevel, string> = {
  safe: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10',
  caution: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
  destructive: 'text-rose-300 border-rose-400/40 bg-rose-500/10',
};

export interface RiskBadgeProps {
  riskLevel: RiskLevel;
}

export function RiskBadge({ riskLevel }: RiskBadgeProps) {
  return (
    <span
      data-testid="risk-badge"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs font-semibold ${RISK_BADGE_CLASSES[riskLevel]}`}
    >
      {riskLevel}
    </span>
  );
}
