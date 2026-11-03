/**
 * Mode badge, fallback notice, history, layout, contrast, and keyboard tests (task 8.9).
 * Requirements: 19.4, 19.7, 19.8, 19.9, 20.3, 20.4, 20.5, 20.8, 22.1, 22.2, 22.3, 22.4, 22.5
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { SAMPLE_INCIDENTS } from '../../src/data/sampleIncidents';
import { MODE_LABELS } from '../../src/components/ModeBadge';
import { FALLBACK_NOTICE_TEXT } from '../../src/components/FallbackNotice';
import { EMPTY_HISTORY_MESSAGE } from '../../src/components/HistoryPanel';
import { HISTORY_SAVE_FAILED_MESSAGE } from '../../src/hooks/useGitPulse';
import {
  createHistoryStore,
  HISTORY_KEY,
  serializeHistory,
  type HistoryStorage,
} from '../../src/lib/history/historyStore';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import type { AnalyzeOutcome } from '../../src/lib/analyzer/analyzer';
import type { AnalysisResult, HistoryEntry } from '../../src/shared/analysisContract';

// ---------- helpers ----------

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const storage: HistoryStorage & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return storage;
}

function failingWriteStorage(): HistoryStorage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
}

const sample = (id: string) => SAMPLE_INCIDENTS.find((s) => s.id === id)!;

function fallbackOutcome(text: string, fallbackReason?: AnalyzeOutcome['fallbackReason']): AnalyzeOutcome {
  const result = validateSafety(analyzeFallback(text));
  return fallbackReason ? { result, fallbackReason } : { result };
}

const BEDROCK_TEXT = 'I ran git reset --hard and need to recover.';

function bedrockResult(): AnalysisResult {
  return validateSafety({
    incidentType: 'lost_commits',
    title: 'Bedrock: recover after a hard reset',
    confidence: 'medium',
    severity: 'high',
    analysisMode: 'bedrock_ai',
    summary: 'Commits may still be reachable through the reflog.',
    detectedEvidence: ['git reset --hard'],
    assumptions: ['The branch name is not shown.'],
    recoverySteps: [
      { stepNumber: 1, title: 'Inspect reflog', explanation: 'Find the lost commit.', command: 'git reflog', riskLevel: 'safe' },
      {
        stepNumber: 2,
        title: 'Reset again',
        explanation: 'Move the branch back.',
        command: 'git reset --hard HEAD@{1}',
        riskLevel: 'caution',
      },
      {
        stepNumber: 3,
        title: 'Update remote',
        explanation: 'Push with a lease.',
        command: 'git push --force-with-lease origin feature',
        riskLevel: 'caution',
      },
    ],
  });
}

function seededEntries(): HistoryEntry[] {
  const fallbackText = sample('merge_conflict').incidentText;
  return [
    {
      id: 'bedrock-entry',
      incidentText: BEDROCK_TEXT,
      result: bedrockResult(),
      createdAt: 2_000_000,
    },
    {
      id: 'fallback-entry',
      incidentText: fallbackText,
      result: validateSafety(analyzeFallback(fallbackText)),
      createdAt: 1_000_000,
      fallbackReason: 'bedrock_timeout',
    },
  ];
}

function seededStorage() {
  return memoryStorage({ [HISTORY_KEY]: serializeHistory(seededEntries()) });
}

function historySection(): HTMLElement {
  return screen.getByRole('region', { name: /recent analyses/i });
}

function resultsSection(): HTMLElement {
  return screen.getByRole('region', { name: /analysis results/i });
}

// ---------- WCAG contrast ----------

const HEX: Record<string, string> = {
  'slate-100': '#f1f5f9',
  'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8',
  'slate-800': '#1e293b',
  'slate-900': '#0f172a',
  'slate-950': '#020617',
  'emerald-100': '#d1fae5',
  'emerald-200': '#a7f3d0',
  'emerald-300': '#6ee7b7',
  'emerald-400': '#34d399',
  'amber-100': '#fef3c7',
  'amber-200': '#fde68a',
  'amber-300': '#fcd34d',
  'amber-400': '#fbbf24',
  'rose-100': '#ffe4e6',
  'rose-200': '#fecdd3',
  'rose-300': '#fda4af',
  'rose-400': '#fb7185',
  'rose-500': '#f43f5e',
  'cyan-100': '#cffafe',
  'cyan-200': '#a5f3fc',
  'cyan-300': '#67e8f9',
  'cyan-400': '#22d3ee',
  'violet-100': '#ede9fe',
  'violet-200': '#ddd6fe',
  'violet-300': '#c4b5fd',
  'violet-400': '#a78bfa',
  'violet-500': '#8b5cf6',
};

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blend(fg: RGB, bg: RGB, alpha: number): RGB {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Light text shades used on the dark surfaces. */
const LIGHT_TEXT_TOKENS = Object.keys(HEX).filter((k) => /-(100|200|300|400)$/.test(k));
const DARK_SURFACES = ['slate-950', 'slate-900', 'slate-800'];
const ACCENT_PALETTES = ['emerald', 'amber', 'rose', 'cyan', 'violet'];

// ---------- tests ----------

describe('Mode badge and fallback notice (Req 19.4, 19.7–19.9)', () => {
  it('shows the fallback mode badge and fallback notice when the analyzer fell back', async () => {
    const user = userEvent.setup();
    const analyzeFn = vi.fn(async (text: string) => fallbackOutcome(text, 'bedrock_error'));
    render(<App store={createHistoryStore(memoryStorage())} analyzeFn={analyzeFn} />);

    await user.click(screen.getByRole('button', { name: sample('rejected_push').label }));
    await user.click(screen.getByRole('button', { name: /analyze incident/i }));

    const results = resultsSection();
    expect(await within(results).findByText(MODE_LABELS.fallback_demo)).toBeInTheDocument();
    expect(within(results).getByText(FALLBACK_NOTICE_TEXT)).toBeInTheDocument();
    expect(within(results).queryByText(MODE_LABELS.bedrock_ai)).not.toBeInTheDocument();
    // History entry also carries the badge (19.9).
    expect(within(historySection()).getByText(MODE_LABELS.fallback_demo)).toBeInTheDocument();
  });

  it('shows the fallback badge without a notice in normal demo mode', async () => {
    const user = userEvent.setup();
    const analyzeFn = vi.fn(async (text: string) => fallbackOutcome(text));
    render(<App store={createHistoryStore(memoryStorage())} analyzeFn={analyzeFn} />);

    await user.click(screen.getByRole('button', { name: sample('detached_head').label }));
    await user.click(screen.getByRole('button', { name: /analyze incident/i }));

    const results = resultsSection();
    expect(await within(results).findByText(MODE_LABELS.fallback_demo)).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_NOTICE_TEXT)).not.toBeInTheDocument();
  });

  it('shows the Amazon Bedrock AI badge and no notice for an accepted Bedrock result', async () => {
    const user = userEvent.setup();
    const analyzeFn = vi.fn(async () => ({ result: bedrockResult() }));
    render(<App store={createHistoryStore(memoryStorage())} analyzeFn={analyzeFn} />);

    await user.type(screen.getByRole('textbox'), BEDROCK_TEXT);
    await user.click(screen.getByRole('button', { name: /analyze incident/i }));

    const results = resultsSection();
    expect(await within(results).findByText('Amazon Bedrock AI')).toBeInTheDocument();
    expect(within(results).queryByText(MODE_LABELS.fallback_demo)).not.toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_NOTICE_TEXT)).not.toBeInTheDocument();
    expect(within(historySection()).getByText('Amazon Bedrock AI')).toBeInTheDocument();
  });

  it('uses the exact mode label texts', () => {
    expect(MODE_LABELS).toEqual({
      bedrock_ai: 'Amazon Bedrock AI',
      fallback_demo: 'Deterministic Fallback / Demo Mode',
    });
  });
});

describe('History panel (Req 19.9, 20.3–20.5, 20.8)', () => {
  it('lists saved entries newest first with title, mode badge, and time', () => {
    render(<App store={createHistoryStore(seededStorage())} analyzeFn={vi.fn()} />);
    const items = within(historySection()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Bedrock: recover after a hard reset');
    expect(items[0]).toHaveTextContent(MODE_LABELS.bedrock_ai);
    expect(items[1]).toHaveTextContent(MODE_LABELS.fallback_demo);
    for (const item of items) expect(item.querySelector('time')).not.toBeNull();
  });

  it('restores a fallback entry with its mode badge and fallback notice without analysis', async () => {
    const user = userEvent.setup();
    const analyzeFn = vi.fn();
    const entries = seededEntries();
    render(<App store={createHistoryStore(seededStorage())} analyzeFn={analyzeFn} />);

    const fallbackEntry = entries[1];
    await user.click(within(historySection()).getByRole('button', { name: new RegExp(fallbackEntry.result.title) }));

    expect(screen.getByRole('textbox')).toHaveValue(fallbackEntry.incidentText);
    const results = resultsSection();
    expect(within(results).getByText(MODE_LABELS.fallback_demo)).toBeInTheDocument();
    expect(within(results).getByText(FALLBACK_NOTICE_TEXT)).toBeInTheDocument();
    expect(within(results).getByRole('heading', { name: fallbackEntry.result.title })).toBeInTheDocument();
    expect(analyzeFn).not.toHaveBeenCalled();
  });

  it('restores a Bedrock entry with the Bedrock badge and no notice without analysis', async () => {
    const user = userEvent.setup();
    const analyzeFn = vi.fn();
    render(<App store={createHistoryStore(seededStorage())} analyzeFn={analyzeFn} />);

    await user.click(within(historySection()).getByRole('button', { name: /Bedrock: recover after a hard reset/ }));

    expect(screen.getByRole('textbox')).toHaveValue(BEDROCK_TEXT);
    const results = resultsSection();
    expect(within(results).getByText(MODE_LABELS.bedrock_ai)).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_NOTICE_TEXT)).not.toBeInTheDocument();
    expect(analyzeFn).not.toHaveBeenCalled();
  });

  it('clear history empties the panel and removes the stored key', async () => {
    const user = userEvent.setup();
    const storage = seededStorage();
    render(<App store={createHistoryStore(storage)} analyzeFn={vi.fn()} />);

    await user.click(within(historySection()).getByRole('button', { name: /clear history/i }));

    expect(within(historySection()).getByText(EMPTY_HISTORY_MESSAGE)).toBeInTheDocument();
    expect(within(historySection()).queryAllByRole('listitem')).toHaveLength(0);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
    expect(within(historySection()).getByRole('button', { name: /clear history/i })).toBeDisabled();
  });

  it('shows "History could not be saved." on write failure and keeps the result', async () => {
    const user = userEvent.setup();
    const analyzeFn = vi.fn(async (text: string) => fallbackOutcome(text));
    render(<App store={createHistoryStore(failingWriteStorage())} analyzeFn={analyzeFn} />);

    await user.click(screen.getByRole('button', { name: sample('stuck_rebase').label }));
    await user.click(screen.getByRole('button', { name: /analyze incident/i }));

    expect(HISTORY_SAVE_FAILED_MESSAGE).toBe('History could not be saved.');
    expect(await screen.findByText('History could not be saved.')).toBeInTheDocument();
    expect(within(resultsSection()).getByText(MODE_LABELS.fallback_demo)).toBeInTheDocument();
    expect(within(resultsSection()).getByRole('heading', { name: /recovery plan/i })).toBeInTheDocument();
  });
});

describe('Layout and dark theme (Req 22.1–22.3)', () => {
  it('uses a single column by default and two columns at lg', () => {
    render(<App store={createHistoryStore(memoryStorage())} analyzeFn={vi.fn()} />);
    const grid = screen.getByTestId('dashboard-grid');
    expect(grid).toHaveClass('grid', 'grid-cols-1', 'lg:grid-cols-2');
    const classes = grid.className.split(/\s+/);
    // No unprefixed or sub-lg multi-column class.
    expect(classes.filter((c) => /^(sm:|md:)?grid-cols-(?!1$)/.test(c))).toEqual([]);
    expect(grid.children).toHaveLength(2);
  });

  it('applies the dark theme tokens to the page and surfaces', () => {
    const { container } = render(<App store={createHistoryStore(memoryStorage())} analyzeFn={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('bg-slate-950', 'text-slate-100');
    expect(container.querySelector('header')).toHaveClass('bg-slate-900');
    expect(container.querySelector('footer')).toHaveClass('bg-slate-900');
    expect(historySection()).toHaveClass('bg-slate-900');
    // Accent colors present.
    expect(container.querySelector('.text-cyan-400')).not.toBeNull();
    expect(container.querySelector('.text-violet-400')).not.toBeNull();
  });
});

describe('Color contrast (Req 22.4)', () => {
  it('every light text token has at least 4.5:1 contrast on every dark surface', () => {
    for (const text of LIGHT_TEXT_TOKENS) {
      for (const bg of DARK_SURFACES) {
        const ratio = contrast(rgb(HEX[text]), rgb(HEX[bg]));
        expect(ratio, `${text} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('accent text keeps 4.5:1 on tinted accent surfaces (up to 20% over slate-900/950)', () => {
    for (const palette of ACCENT_PALETTES) {
      for (const tintShade of ['400', '500'] as const) {
        const tintHex = HEX[`${palette}-${tintShade}`] ?? HEX[`${palette}-400`];
        for (const base of ['slate-900', 'slate-950']) {
          const surface = blend(rgb(tintHex), rgb(HEX[base]), 0.2);
          for (const shade of ['100', '200', '300']) {
            const ratio = contrast(rgb(HEX[`${palette}-${shade}`]), surface);
            expect(ratio, `${palette}-${shade} on ${palette}-${tintShade}/20 over ${base}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it('slate-950 text on the cyan-400 primary button has at least 4.5:1', () => {
    expect(contrast(rgb(HEX['slate-950']), rgb(HEX['cyan-400']))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(HEX['slate-950']), rgb(HEX['cyan-300']))).toBeGreaterThanOrEqual(4.5);
  });

  it('every text color class rendered in the dashboard is a checked token', async () => {
    const user = userEvent.setup();
    const { container } = render(<App store={createHistoryStore(seededStorage())} analyzeFn={vi.fn()} />);
    // Render a result with safe, caution, and destructive steps plus the fallback notice.
    await user.click(within(historySection()).getByRole('button', { name: /Bedrock: recover after a hard reset/ }));
    const bedrockMarkup = container.innerHTML;
    await user.click(within(historySection()).getByRole('button', { name: /Merge conflict|merge/i }));
    const markup = bedrockMarkup + container.innerHTML;

    const tokens = new Set<string>();
    for (const m of markup.matchAll(/class="([^"]*)"/g)) {
      for (const cls of m[1].split(/\s+/)) {
        const t = /^(?:[a-z-]+:)*text-((?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+)(?:\/\d+)?$/.exec(cls);
        if (t) tokens.add(t[1]);
      }
    }
    expect(tokens.size).toBeGreaterThan(0);
    const checked = new Set([...LIGHT_TEXT_TOKENS, 'slate-950']);
    for (const token of tokens) expect(checked, `unchecked text token ${token}`).toContain(token);

    // Dark text is used only on the cyan primary button.
    for (const el of container.querySelectorAll('.text-slate-950')) {
      expect(el).toHaveClass('bg-cyan-400');
    }
  });
});

describe('Keyboard access (Req 22.5)', () => {
  it('tab moves through sample buttons, the textarea, Reset, then Analyze', async () => {
    const user = userEvent.setup();
    render(<App store={createHistoryStore(memoryStorage())} analyzeFn={vi.fn()} />);

    for (const s of SAMPLE_INCIDENTS) {
      await user.tab();
      expect(screen.getByRole('button', { name: s.label })).toHaveFocus();
    }
    await user.tab();
    expect(screen.getByRole('textbox')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /^reset$/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /analyze incident/i })).toHaveFocus();
  });

  it('reaches history entries and the clear button by keyboard', async () => {
    const user = userEvent.setup();
    render(<App store={createHistoryStore(seededStorage())} analyzeFn={vi.fn()} />);
    screen.getByRole('button', { name: /analyze incident/i }).focus();
    await user.tab();
    expect(within(historySection()).getByRole('button', { name: /clear history/i })).toHaveFocus();
    await user.tab();
    expect(within(historySection()).getByRole('button', { name: /Bedrock: recover after a hard reset/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue(BEDROCK_TEXT);
  });

  it('every button and the textarea have a visible focus ring', async () => {
    const user = userEvent.setup();
    render(<App store={createHistoryStore(seededStorage())} analyzeFn={vi.fn()} writeText={async () => {}} />);
    // Show a result so step copy buttons are rendered too.
    await user.click(within(historySection()).getByRole('button', { name: /Bedrock: recover after a hard reset/ }));

    const controls = [...screen.getAllByRole('button'), screen.getByRole('textbox')];
    expect(controls.length).toBeGreaterThan(8);
    for (const el of controls) {
      expect(el.className, el.textContent ?? el.tagName).toContain('focus-visible:ring-2');
      expect(el.className).toContain('focus-visible:ring-cyan-400');
    }
  });
});
