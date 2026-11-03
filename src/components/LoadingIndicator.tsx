/** Loading indicator shown while an analysis is in progress (Req 21.2). */

import { Loader2 } from 'lucide-react';

export const LOADING_MESSAGE = 'Analyzing incident…';

export function LoadingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-8 text-slate-200"
    >
      <Loader2 className="h-5 w-5 animate-spin text-cyan-400" aria-hidden="true" />
      <span className="text-sm">{LOADING_MESSAGE}</span>
    </div>
  );
}
