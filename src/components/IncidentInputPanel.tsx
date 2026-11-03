/**
 * Incident_Input panel (Req 1.1–1.7, 21.2, 22.5).
 *
 * Presentational: all state comes from props. The "Analyze Incident" button is
 * disabled while an analysis is loading. The inline validation message uses
 * role="alert" so screen readers announce it.
 */

import { useId } from 'react';
import type { FormEvent } from 'react';
import { Loader2, RotateCcw, Search } from 'lucide-react';
import { MAX_INCIDENT_CHARS } from '../shared/analysisContract';

export interface IncidentInputPanelProps {
  text: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  loading: boolean;
  validationMessage: string | null;
}

export const INCIDENT_INPUT_LABEL = 'Git error or terminal output';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';

export function formatCharacterCount(length: number): string {
  return `${length.toLocaleString('en-US')} / ${MAX_INCIDENT_CHARS.toLocaleString('en-US')}`;
}

export function IncidentInputPanel({
  text,
  onChange,
  onSubmit,
  onReset,
  loading,
  validationMessage,
}: IncidentInputPanelProps) {
  const baseId = useId();
  const textareaId = `${baseId}-incident-text`;
  const counterId = `${baseId}-counter`;
  const messageId = `${baseId}-validation`;
  const overLimit = text.length > MAX_INCIDENT_CHARS;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) onSubmit();
  };

  const describedBy = validationMessage ? `${counterId} ${messageId}` : counterId;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"
    >
      <label htmlFor={textareaId} className="text-sm font-semibold text-slate-100">
        {INCIDENT_INPUT_LABEL}
      </label>
      <textarea
        id={textareaId}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        rows={12}
        spellCheck={false}
        placeholder="Paste a Git error, git status / git reflog output, or describe your problem."
        aria-describedby={describedBy}
        aria-invalid={validationMessage ? true : undefined}
        className={`min-h-[12rem] w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-100 placeholder:text-slate-400 ${FOCUS_RING}`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id={counterId}
          className={`font-mono text-xs ${overLimit ? 'text-rose-300' : 'text-slate-300'}`}
        >
          {formatCharacterCount(text.length)}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className={`inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 ${FOCUS_RING}`}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset
          </button>
          <button
            type="submit"
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}
            Analyze Incident
          </button>
        </div>
      </div>

      {validationMessage ? (
        <p id={messageId} role="alert" className="text-sm text-rose-300">
          {validationMessage}
        </p>
      ) : null}
    </form>
  );
}
