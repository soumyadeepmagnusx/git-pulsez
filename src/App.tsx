/**
 * GitPulse Dashboard layout (Req 21.1, 22.1–22.5, 23.2).
 *
 * Single column by default, two columns at the `lg` breakpoint (≥1024 px).
 * Left column: Sample_Incidents, Incident_Input, History_Panel.
 * Right column: empty, loading, error, or result state.
 *
 * Dependencies are injectable for tests; defaults are created once per mount.
 */

import { useState } from 'react';
import { GitBranch, ShieldAlert } from 'lucide-react';
import { SAMPLE_INCIDENTS } from './data/sampleIncidents';
import { analyze, defaultAnalyzerDeps, type AnalyzeOutcome } from './lib/analyzer/analyzer';
import { createHistoryStore, type HistoryStorage, type HistoryStore } from './lib/history/historyStore';
import { useGitPulse } from './hooks/useGitPulse';
import { SampleIncidentBar } from './components/SampleIncidentBar';
import { IncidentInputPanel } from './components/IncidentInputPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { EmptyState } from './components/EmptyState';
import { LoadingIndicator } from './components/LoadingIndicator';
import { ErrorState } from './components/ErrorState';
import { FallbackNotice } from './components/FallbackNotice';
import { AnalysisHeader } from './components/AnalysisHeader';
import { EvidenceLists } from './components/EvidenceLists';
import { RecoveryPlan } from './components/RecoveryPlan';

export interface AppProps {
  store?: HistoryStore;
  analyzeFn?: (text: string) => Promise<AnalyzeOutcome>;
  writeText?: (text: string) => Promise<void>;
}

export const FOOTER_NOTE =
  'GitPulse never runs commands. You copy each command and run it yourself in your own terminal after reviewing it.';

function createMemoryStorage(): HistoryStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** `window.localStorage` can be missing or throw on access (for example in private mode). */
function resolveStorage(): HistoryStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Fall through to in-memory storage.
  }
  return createMemoryStorage();
}

function defaultAnalyzeFn(text: string): Promise<AnalyzeOutcome> {
  return analyze(text, defaultAnalyzerDeps());
}

export function App({ store: storeProp, analyzeFn, writeText }: AppProps = {}) {
  const [store] = useState<HistoryStore>(() => storeProp ?? createHistoryStore(resolveStorage()));
  const [analyzeImpl] = useState(() => analyzeFn ?? defaultAnalyzeFn);

  const { state, edit, selectSample, submit, retry, reset, selectHistory, clearHistory } = useGitPulse({
    store,
    analyze: analyzeImpl,
  });

  const loading = state.status === 'loading';

  let results;
  if (state.status === 'loading') {
    results = <LoadingIndicator />;
  } else if (state.status === 'error') {
    results = <ErrorState message={state.error ?? 'GitPulse could not analyze this incident.'} onRetry={retry} />;
  } else if (state.status === 'done' && state.outcome) {
    const { result, fallbackReason } = state.outcome;
    results = (
      <>
        <FallbackNotice fallbackReason={fallbackReason} />
        <AnalysisHeader result={result} />
        <EvidenceLists detectedEvidence={result.detectedEvidence} assumptions={result.assumptions} />
        <RecoveryPlan steps={result.recoverySteps} writeText={writeText} />
      </>
    );
  } else {
    results = <EmptyState />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <GitBranch className="h-7 w-7 text-cyan-400" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Git<span className="text-violet-400">Pulse</span>
            </h1>
            <p className="text-sm text-slate-300">
              Paste a Git error and get an ordered, safety-first recovery plan.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div data-testid="dashboard-grid" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <SampleIncidentBar
              samples={SAMPLE_INCIDENTS}
              activeSampleId={state.activeSampleId}
              onSelect={selectSample}
            />
            <IncidentInputPanel
              text={state.text}
              onChange={edit}
              onSubmit={submit}
              onReset={reset}
              loading={loading}
              validationMessage={state.validationMessage}
            />
            <HistoryPanel
              entries={state.history}
              onSelect={selectHistory}
              onClear={clearHistory}
              warning={state.historyWarning}
            />
          </div>
          <section aria-label="Analysis results" aria-busy={loading} className="flex min-w-0 flex-col gap-4">
            {results}
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-800 bg-slate-900">
        <p className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-4 text-sm text-slate-300 sm:px-6">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          {FOOTER_NOTE}
        </p>
      </footer>
    </div>
  );
}

export default App;
