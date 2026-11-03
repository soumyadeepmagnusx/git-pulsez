/**
 * History_Panel (Req 19.9, 20.3–20.5, 20.8, 21.3).
 *
 * Lists History_Entries newest first with the result title, Mode_Badge, and creation
 * time. Selecting an entry calls `onSelect(id)`; the parent restores the text and result
 * without starting a new analysis. The clear button is disabled when the list is empty.
 * A history warning (for example "History could not be saved.") is shown as an alert.
 */

import { AlertTriangle, History, Trash2 } from 'lucide-react';
import type { HistoryEntry } from '../shared/analysisContract';
import { ModeBadge } from './ModeBadge';

export const EMPTY_HISTORY_MESSAGE = 'No saved analyses yet.';

export interface HistoryPanelProps {
  entries: readonly HistoryEntry[];
  onSelect: (id: string) => void;
  onClear: () => void;
  warning?: string;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';

function formatTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function HistoryPanel({ entries, onSelect, onClear, warning }: HistoryPanelProps) {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  const empty = sorted.length === 0;

  return (
    <section
      aria-labelledby="history-heading"
      className="rounded-xl border border-slate-800 bg-slate-900 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="history-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <History className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          Recent analyses
        </h2>
        <button
          type="button"
          onClick={onClear}
          disabled={empty}
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-rose-400 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-700 disabled:hover:text-slate-200 ${FOCUS_RING}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Clear history
        </button>
      </div>

      {warning && (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {warning}
        </p>
      )}

      {empty ? (
        <p className="text-sm text-slate-300">{EMPTY_HISTORY_MESSAGE}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry.id)}
                className={`flex w-full flex-col items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left hover:border-cyan-400 ${FOCUS_RING}`}
              >
                <span className="text-sm font-medium text-slate-100">{entry.result.title}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <ModeBadge mode={entry.result.analysisMode} />
                  <time
                    dateTime={new Date(entry.createdAt).toISOString()}
                    className="text-xs text-slate-300"
                  >
                    {formatTime(entry.createdAt)}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
