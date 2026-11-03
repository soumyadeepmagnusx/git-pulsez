/**
 * Input, Sample_Incident, and interface-state tests for the Dashboard.
 * Requirements: 1.1–1.7, 2.1–2.4, 21.1–21.4.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';
import { createHistoryStore, type HistoryStorage } from '../../src/lib/history/historyStore';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { SAMPLE_INCIDENTS } from '../../src/data/sampleIncidents';
import { INCIDENT_INPUT_LABEL } from '../../src/components/IncidentInputPanel';
import { EMPTY_STATE_MESSAGE } from '../../src/components/EmptyState';
import { EMPTY_HISTORY_MESSAGE } from '../../src/components/HistoryPanel';
import { LOADING_MESSAGE } from '../../src/components/LoadingIndicator';
import type { AnalyzeOutcome } from '../../src/lib/analyzer/analyzer';

const REQUIRED_MESSAGE = 'Incident text is required.';
const TOO_LONG_MESSAGE = 'Incident text must be 20,000 characters or fewer.';

function memoryStorage(): HistoryStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

function outcomeFor(text: string): AnalyzeOutcome {
  return { result: analyzeFallback(text) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(analyzeFn = vi.fn((text: string) => Promise.resolve(outcomeFor(text)))) {
  const user = userEvent.setup();
  render(<App store={createHistoryStore(memoryStorage())} analyzeFn={analyzeFn} />);
  const textarea = screen.getByLabelText(INCIDENT_INPUT_LABEL) as HTMLTextAreaElement;
  const analyzeButton = screen.getByRole('button', { name: /analyze incident/i });
  const results = screen.getByRole('region', { name: 'Analysis results' });
  return { user, analyzeFn, textarea, analyzeButton, results };
}

const sampleText = SAMPLE_INCIDENTS[0].incidentText;
const sampleTitle = analyzeFallback(sampleText).title;

describe('Incident_Input (Req 1)', () => {
  it('renders a multi-line text area and an Analyze Incident button (1.1, 1.2)', () => {
    const { textarea, analyzeButton } = setup();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(analyzeButton).toBeEnabled();
  });

  it('starts analysis with the Incident_Text for valid input (1.3)', async () => {
    const { user, textarea, analyzeButton, analyzeFn, results } = setup();
    fireEvent.change(textarea, { target: { value: sampleText } });
    await user.click(analyzeButton);
    expect(analyzeFn).toHaveBeenCalledTimes(1);
    expect(analyzeFn).toHaveBeenCalledWith(sampleText);
    expect(await within(results).findByText(sampleTitle)).toBeInTheDocument();
  });

  it.each(['', '   \n\t  '])('shows a required message and keeps the Analyzer idle for %j (1.4)', async (value) => {
    const { user, textarea, analyzeButton, analyzeFn } = setup();
    fireEvent.change(textarea, { target: { value } });
    await user.click(analyzeButton);
    expect(screen.getByRole('alert')).toHaveTextContent(REQUIRED_MESSAGE);
    expect(analyzeFn).not.toHaveBeenCalled();
  });

  it('shows the 20,000-character limit message and keeps the Analyzer idle (1.5)', async () => {
    const { user, textarea, analyzeButton, analyzeFn } = setup();
    fireEvent.change(textarea, { target: { value: 'a'.repeat(20_001) } });
    await user.click(analyzeButton);
    expect(screen.getByRole('alert')).toHaveTextContent(TOO_LONG_MESSAGE);
    expect(analyzeFn).not.toHaveBeenCalled();
  });

  it('accepts exactly 20,000 characters (1.3, 1.5 boundary)', async () => {
    const { user, textarea, analyzeButton, analyzeFn } = setup();
    const value = 'a'.repeat(20_000);
    fireEvent.change(textarea, { target: { value } });
    await user.click(analyzeButton);
    expect(analyzeFn).toHaveBeenCalledWith(value);
  });

  it('displays the character count next to the limit (1.6)', () => {
    const { textarea } = setup();
    expect(screen.getByText('0 / 20,000')).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(screen.getByText('5 / 20,000')).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: 'a'.repeat(20_001) } });
    expect(screen.getByText('20,001 / 20,000')).toBeInTheDocument();
  });

  it('reset clears the text, validation message, and result (1.7)', async () => {
    const { user, textarea, analyzeButton, results } = setup();
    await user.click(analyzeButton);
    expect(screen.getByRole('alert')).toHaveTextContent(REQUIRED_MESSAGE);
    await user.click(screen.getByRole('button', { name: /reset/i }));
    expect(screen.queryByText(REQUIRED_MESSAGE)).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: sampleText } });
    await user.click(analyzeButton);
    expect(await within(results).findByText(sampleTitle)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reset/i }));
    expect(textarea.value).toBe('');
    expect(within(results).queryByText(sampleTitle)).not.toBeInTheDocument();
    expect(within(results).getByText(EMPTY_STATE_MESSAGE)).toBeInTheDocument();
  });
});

describe('Sample_Incidents (Req 2.1–2.4)', () => {
  it('shows 5 sample buttons, one per Supported_Incident_Type (2.1)', () => {
    setup();
    const bar = screen.getByRole('region', { name: 'Sample incidents' });
    const buttons = within(bar).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(new Set(SAMPLE_INCIDENTS.map((s) => s.id)).size).toBe(5);
    for (const sample of SAMPLE_INCIDENTS) {
      expect(within(bar).getByRole('button', { name: sample.label })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('replaces the text, marks the active button, and editing clears the mark (2.2–2.4)', async () => {
    const { user, textarea } = setup();
    fireEvent.change(textarea, { target: { value: 'old text' } });

    for (const sample of SAMPLE_INCIDENTS) {
      const button = screen.getByRole('button', { name: sample.label });
      await user.click(button);
      expect(textarea.value).toBe(sample.incidentText);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      for (const other of SAMPLE_INCIDENTS.filter((s) => s.id !== sample.id)) {
        expect(screen.getByRole('button', { name: other.label })).toHaveAttribute('aria-pressed', 'false');
      }
    }

    const last = SAMPLE_INCIDENTS[SAMPLE_INCIDENTS.length - 1];
    await user.type(textarea, 'x');
    expect(textarea.value).toBe(`${last.incidentText}x`);
    for (const sample of SAMPLE_INCIDENTS) {
      expect(screen.getByRole('button', { name: sample.label })).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

describe('Interface states (Req 21.1–21.4)', () => {
  it('shows the empty state and empty history message initially (21.1, 21.3)', () => {
    const { results } = setup();
    expect(within(results).getByText(EMPTY_STATE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_HISTORY_MESSAGE)).toBeInTheDocument();
  });

  it('shows a loading indicator and disables Analyze Incident while analyzing (21.2)', async () => {
    const pending = deferred<AnalyzeOutcome>();
    const analyzeFn = vi.fn(() => pending.promise);
    const { user, textarea, analyzeButton, results } = setup(analyzeFn);
    fireEvent.change(textarea, { target: { value: sampleText } });
    await user.click(analyzeButton);

    expect(within(results).getByRole('status')).toHaveTextContent(LOADING_MESSAGE);
    expect(analyzeButton).toBeDisabled();
    await user.click(analyzeButton);
    expect(analyzeFn).toHaveBeenCalledTimes(1);

    pending.resolve(outcomeFor(sampleText));
    expect(await within(results).findByText(sampleTitle)).toBeInTheDocument();
    expect(within(results).queryByRole('status')).not.toBeInTheDocument();
    expect(analyzeButton).toBeEnabled();
    expect(screen.queryByText(EMPTY_HISTORY_MESSAGE)).not.toBeInTheDocument();
  });

  it('shows an error state with a description and a working retry (21.4)', async () => {
    const analyzeFn = vi
      .fn<(text: string) => Promise<AnalyzeOutcome>>()
      .mockRejectedValueOnce(new Error('Network down.'))
      .mockImplementation((text) => Promise.resolve(outcomeFor(text)));
    const { user, textarea, analyzeButton, results } = setup(analyzeFn);
    fireEvent.change(textarea, { target: { value: sampleText } });
    await user.click(analyzeButton);

    const error = await within(results).findByRole('alert');
    expect(error).toHaveTextContent('Analysis failed');
    expect(error).toHaveTextContent('GitPulse could not analyze this incident.');
    expect(error).toHaveTextContent('Network down.');

    await user.click(within(error).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(analyzeFn).toHaveBeenCalledTimes(2));
    expect(analyzeFn).toHaveBeenLastCalledWith(sampleText);
    expect(await within(results).findByText(sampleTitle)).toBeInTheDocument();
    expect(within(results).queryByRole('alert')).not.toBeInTheDocument();
  });
});
