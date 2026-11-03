/** Notice shown when the Analyzer fell back after a Bedrock_Handler failure (Req 19.4). */

import { Info } from 'lucide-react';
import type { FallbackReason } from '../shared/analysisContract';

export const FALLBACK_NOTICE_TEXT =
  'Amazon Bedrock was unavailable. This result came from Deterministic Fallback / Demo Mode.';

export interface FallbackNoticeProps {
  fallbackReason?: FallbackReason;
}

export function FallbackNotice({ fallbackReason }: FallbackNoticeProps) {
  if (fallbackReason === undefined) return null;
  return (
    <div
      role="status"
      data-fallback-reason={fallbackReason}
      className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-slate-900 px-4 py-3 text-sm text-amber-300"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{FALLBACK_NOTICE_TEXT}</p>
    </div>
  );
}
