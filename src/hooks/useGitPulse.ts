/**
 * Dashboard state (design: "useGitPulse reducer").
 *
 * - Submit validates the Incident_Text first; on failure the Analyzer stays idle (Req 1.3–1.5).
 * - On success a History_Entry (with `fallbackReason`) is saved; a failed write shows
 *   "History could not be saved." while the result stays displayed (Req 20.1, 20.8).
 * - Editing clears the active Sample_Incident (Req 2.4); reset clears text, validation,
 *   and result (Req 1.7); selecting history restores text and result without analysis (Req 20.4).
 * - History is loaded from the store on mount (Req 20.6).
 * - Loading disables analysis (Req 21.2); Analyzer failures show an error state (Req 21.4).
 *
 * The reducer is pure and exported so it can be tested without React. Dependencies
 * (store, analyze, clock, id generator) are injected.
 */

import { useCallback, useReducer, useRef } from 'react';
import type { HistoryEntry, SupportedIncidentType } from '../shared/analysisContract';
import { SAMPLE_INCIDENTS } from '../data/sampleIncidents';
import type { AnalyzeOutcome } from '../lib/analyzer/analyzer';
import type { HistoryStore } from '../lib/history/historyStore';
import { validateIncidentText } from '../lib/input/validateIncidentText';

export const HISTORY_SAVE_FAILED_MESSAGE = 'History could not be saved.';
export const ANALYSIS_FAILED_MESSAGE = 'GitPulse could not analyze this incident.';

export type GitPulseStatus = 'idle' | 'loading' | 'done' | 'error';

export interface GitPulseState {
  text: string;
  activeSampleId: SupportedIncidentType | null;
  validationMessage: string | null;
  status: GitPulseStatus;
  outcome?: AnalyzeOutcome;
  error?: string;
  history: HistoryEntry[];
  historyWarning?: string;
}

export type GitPulseAction =
  | { type: 'edit'; text: string }
  | { type: 'selectSample'; id: SupportedIncidentType; text: string }
  | { type: 'submit' }
  | { type: 'succeeded'; outcome: AnalyzeOutcome; history: HistoryEntry[]; persisted: boolean }
  | { type: 'failed'; message: string }
  | { type: 'reset' }
  | { type: 'selectHistory'; entry: HistoryEntry }
  | { type: 'clearHistory' };

export const initialGitPulseState: GitPulseState = {
  text: '',
  activeSampleId: null,
  validationMessage: null,
  status: 'idle',
  history: [],
};

/** Leaving `loading` without a result: fall back to the state that was shown before. */
function settledStatus(state: GitPulseState): GitPulseStatus {
  if (state.status !== 'loading') return state.status;
  return state.outcome ? 'done' : 'idle';
}

function withoutKeys<K extends keyof GitPulseState>(state: GitPulseState, ...keys: K[]): GitPulseState {
  const next = { ...state };
  for (const key of keys) delete next[key];
  return next;
}

function outcomeFromEntry(entry: HistoryEntry): AnalyzeOutcome {
  return entry.fallbackReason === undefined
    ? { result: entry.result }
    : { result: entry.result, fallbackReason: entry.fallbackReason };
}

export function gitPulseReducer(state: GitPulseState, action: GitPulseAction): GitPulseState {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        text: action.text,
        activeSampleId: null,
        validationMessage: null,
        status: settledStatus(state),
      };

    case 'selectSample':
      return {
        ...state,
        text: action.text,
        activeSampleId: action.id,
        validationMessage: null,
        status: settledStatus(state),
      };

    case 'submit': {
      if (state.status === 'loading') return state;
      const validation = validateIncidentText(state.text);
      if (!validation.ok) {
        return { ...state, validationMessage: validation.message };
      }
      return { ...withoutKeys(state, 'error'), validationMessage: null, status: 'loading' };
    }

    case 'succeeded': {
      const next: GitPulseState = {
        ...withoutKeys(state, 'error', 'historyWarning'),
        status: 'done',
        outcome: action.outcome,
        history: action.history,
      };
      if (!action.persisted) next.historyWarning = HISTORY_SAVE_FAILED_MESSAGE;
      return next;
    }

    case 'failed':
      return { ...withoutKeys(state, 'outcome'), status: 'error', error: action.message };

    case 'reset':
      return {
        ...withoutKeys(state, 'outcome', 'error'),
        text: '',
        activeSampleId: null,
        validationMessage: null,
        status: 'idle',
      };

    case 'selectHistory':
      return {
        ...withoutKeys(state, 'error'),
        text: action.entry.incidentText,
        activeSampleId: null,
        validationMessage: null,
        status: 'done',
        outcome: outcomeFromEntry(action.entry),
      };

    case 'clearHistory':
      return { ...withoutKeys(state, 'historyWarning'), history: [] };
  }
}

export interface UseGitPulseDeps {
  store: HistoryStore;
  analyze: (text: string) => Promise<AnalyzeOutcome>;
  now?: () => number;
  makeId?: () => string;
}

export interface UseGitPulse {
  state: GitPulseState;
  edit(text: string): void;
  selectSample(id: SupportedIncidentType): void;
  submit(): void;
  retry(): void;
  reset(): void;
  selectHistory(id: string): void;
  clearHistory(): void;
}

function defaultMakeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function errorMessageFor(error: unknown): string {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
  return `${ANALYSIS_FAILED_MESSAGE}${detail}`;
}

/** Lazy initializer: loads saved history once on mount (Req 20.6). */
function initState(store: HistoryStore): GitPulseState {
  return { ...initialGitPulseState, history: store.load() };
}

export function useGitPulse({ store, analyze, now = Date.now, makeId = defaultMakeId }: UseGitPulseDeps): UseGitPulse {
  const [state, dispatch] = useReducer(gitPulseReducer, store, initState);
  // Each request gets an id; any later user action bumps it so late results are ignored.
  const requestRef = useRef(0);

  const submit = useCallback(() => {
    if (state.status === 'loading') return;
    const text = state.text;
    dispatch({ type: 'submit' });
    if (!validateIncidentText(text).ok) return; // Analyzer stays idle (Req 1.4, 1.5)

    requestRef.current += 1;
    const requestId = requestRef.current;
    analyze(text).then(
      (outcome) => {
        if (requestId !== requestRef.current) return;
        const entry: HistoryEntry = {
          id: makeId(),
          incidentText: text,
          result: outcome.result,
          createdAt: now(),
        };
        if (outcome.fallbackReason !== undefined) entry.fallbackReason = outcome.fallbackReason;
        const saved = store.save(entry);
        dispatch({ type: 'succeeded', outcome, history: saved.entries, persisted: saved.persisted });
      },
      (error: unknown) => {
        if (requestId !== requestRef.current) return;
        dispatch({ type: 'failed', message: errorMessageFor(error) });
      },
    );
  }, [state.status, state.text, analyze, makeId, now, store]);

  const edit = useCallback((text: string) => {
    requestRef.current += 1;
    dispatch({ type: 'edit', text });
  }, []);

  const selectSample = useCallback((id: SupportedIncidentType) => {
    const sample = SAMPLE_INCIDENTS.find((s) => s.id === id);
    if (!sample) return;
    requestRef.current += 1;
    dispatch({ type: 'selectSample', id, text: sample.incidentText });
  }, []);

  const reset = useCallback(() => {
    requestRef.current += 1;
    dispatch({ type: 'reset' });
  }, []);

  const selectHistory = useCallback(
    (id: string) => {
      const entry = state.history.find((e) => e.id === id);
      if (!entry) return;
      requestRef.current += 1;
      dispatch({ type: 'selectHistory', entry });
    },
    [state.history],
  );

  const clearHistory = useCallback(() => {
    store.clear();
    dispatch({ type: 'clearHistory' });
  }, [store]);

  return { state, edit, selectSample, submit, retry: submit, reset, selectHistory, clearHistory };
}
