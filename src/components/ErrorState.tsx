/** Error state with a failure description and a retry control (Req 21.4). */

import { AlertTriangle, RefreshCw } from 'lucide-react';

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-rose-400/40 bg-slate-900 p-6"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-rose-300">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        Analysis failed
      </h2>
      <p className="text-sm text-slate-200">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 ${FOCUS_RING}`}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}
