/** Residual_Risk_Label badge, shown when the warning contains the label (Req 11.19). */

import { RESIDUAL_RISK_LABEL } from '../shared/analysisContract';

export interface ResidualRiskBadgeProps {
  warningMessage?: string;
}

export function ResidualRiskBadge({ warningMessage }: ResidualRiskBadgeProps) {
  if (!warningMessage || !warningMessage.includes(RESIDUAL_RISK_LABEL)) return null;
  return (
    <span
      data-testid="residual-risk-badge"
      className="inline-flex items-center rounded-full border border-violet-400/40 bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-300"
    >
      {RESIDUAL_RISK_LABEL}
    </span>
  );
}
