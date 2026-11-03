/** Mode_Badge showing which Analysis_Mode produced a result (Req 19.7–19.9). */

import { Cpu, Sparkles } from 'lucide-react';
import type { AnalysisMode } from '../shared/analysisContract';

export const MODE_LABELS: Record<AnalysisMode, string> = {
  bedrock_ai: 'Amazon Bedrock AI',
  fallback_demo: 'Deterministic Fallback / Demo Mode',
};

export interface ModeBadgeProps {
  mode: AnalysisMode;
}

export function ModeBadge({ mode }: ModeBadgeProps) {
  const isBedrock = mode === 'bedrock_ai';
  const Icon = isBedrock ? Sparkles : Cpu;
  const colors = isBedrock
    ? 'border-violet-400/40 bg-violet-400/10 text-violet-300'
    : 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300';
  return (
    <span
      data-mode={mode}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {MODE_LABELS[mode]}
    </span>
  );
}
