/**
 * Result display and copy component tests.
 *
 * Requirements: 10.3, 10.4, 10.7, 11.17, 11.18, 11.19, 11.23, 17.1, 17.2, 17.3,
 * 17.4, 17.5, 18.1, 18.2, 18.3, 18.4, 18.6, 18.7, 22.6, 22.7
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  type AnalysisResult,
  type RecoveryStep,
  RESIDUAL_RISK_LABEL,
  containsOverclaim,
} from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { AnalysisHeader, LIKELY_DIAGNOSIS_TEXT } from '../../src/components/AnalysisHeader';
import { EvidenceLists, EMPTY_LIST_PLACEHOLDER } from '../../src/components/EvidenceLists';
import { RecoveryPlan } from '../../src/components/RecoveryPlan';
import { RISK_BADGE_CLASSES } from '../../src/components/RiskBadge';
import { MANUAL_RUN_REMINDER } from '../../src/components/ManualRunReminder';
import { COPIED_DURATION_MS, COPY_FAILED_MESSAGE } from '../../src/components/CopyButton';
import { MODE_LABELS } from '../../src/components/ModeBadge';

function step(stepNumber: number, command: string, overrides: Partial<RecoveryStep> = {}): RecoveryStep {
  return {
    stepNumber,
    title: `Step for ${command}`,
    explanation: `Explanation for ${command}`,
    command,
    riskLevel: 'safe',
    ...overrides,
  };
}

function result(steps: RecoveryStep[], overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    incidentType: 'lost_commits',
    title: 'Commits lost after a hard reset',
    confidence: 'medium',
    severity: 'high',
    analysisMode: 'fallback_demo',
    summary: 'HEAD moved back and some commits are no longer on the branch.',
    detectedEvidence: ['reset: moving to HEAD~1'],
    assumptions: ['The remote is named origin.'],
    recoverySteps: steps,
    ...overrides,
  };
}

/** Validated plan with a destructive reset (safeguards inserted) and a caution lease push. */
function validatedPlan(): AnalysisResult {
  return validateSafety(
    result([
      step(1, 'git reflog'),
      step(2, 'git reset --hard HEAD~1', { riskLevel: 'safe' }),
      step(3, 'git push --force-with-lease origin feature', { riskLevel: 'safe' }),
    ]),
  );
}

/** Validated plan whose Safeguard_Window is already complete before the reset. */
function completeWindowPlan(): AnalysisResult {
  return validateSafety(
    result([
      step(1, 'git status'),
      step(2, 'git stash push -u'),
      step(3, 'git reset --hard HEAD~1', { warningMessage: 'Check your work first.' }),
    ]),
  );
}

function cards(): HTMLElement[] {
  return screen.getAllByTestId('recovery-step');
}

function cardFor(command: string): HTMLElement {
  const card = cards().find((c) => within(c).getByTestId('command-text').textContent === command);
  if (!card) throw new Error(`No card for ${command}`);
  return card;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AnalysisHeader and EvidenceLists', () => {
  it('displays title, summary, incident type, severity, confidence, and mode badge (17.1, 10.7)', () => {
    const r = analyzeFallback(
      "To github.com:me/repo.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\nhint: Updates were rejected because the remote contains work that you do not have locally.",
    );
    render(<AnalysisHeader result={validateSafety(r)} />);
    expect(screen.getByText(r.title)).toBeInTheDocument();
    expect(screen.getByText(r.summary)).toBeInTheDocument();
    expect(screen.getByText(`(${r.incidentType})`)).toBeInTheDocument();
    expect(screen.getByText(r.severity)).toBeInTheDocument();
    expect(screen.getByText(`Confidence: ${r.confidence}`)).toBeInTheDocument();
    expect(screen.getByText(LIKELY_DIAGNOSIS_TEXT)).toBeInTheDocument();
    expect(LIKELY_DIAGNOSIS_TEXT).toMatch(/likely/i);
    expect(screen.getByText(MODE_LABELS.fallback_demo)).toBeInTheDocument();
  });

  it('shows two labeled lists with their entries (10.3)', () => {
    render(<EvidenceLists detectedEvidence={['CONFLICT (content)']} assumptions={['Branch is main.']} />);
    const evidence = screen.getByRole('region', { name: 'Detected Evidence' });
    const assumptions = screen.getByRole('region', { name: 'Assumptions' });
    expect(within(evidence).getByText('CONFLICT (content)')).toBeInTheDocument();
    expect(within(assumptions).getByText('Branch is main.')).toBeInTheDocument();
  });

  it('shows placeholders for empty lists (10.4)', () => {
    render(<EvidenceLists detectedEvidence={[]} assumptions={[]} />);
    expect(within(screen.getByRole('region', { name: 'Detected Evidence' })).getByText(EMPTY_LIST_PLACEHOLDER)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Assumptions' })).getByText(EMPTY_LIST_PLACEHOLDER)).toBeInTheDocument();
  });
});

describe('RecoveryPlan step order and card contents', () => {
  it('sorts steps by stepNumber and shows number, title, explanation, badge, and monospace command (17.2, 17.3)', () => {
    const steps = [step(3, 'git log --oneline'), step(1, 'git status'), step(2, 'git fetch origin')];
    render(<RecoveryPlan steps={steps} />);
    const rendered = cards();
    expect(rendered.map((c) => within(c).getByTestId('command-text').textContent)).toEqual([
      'git status',
      'git fetch origin',
      'git log --oneline',
    ]);
    rendered.forEach((card, i) => {
      const s = [steps[1], steps[2], steps[0]][i];
      expect(within(card).getByText(String(s.stepNumber))).toBeInTheDocument();
      expect(within(card).getByText(s.title)).toBeInTheDocument();
      expect(within(card).getByText(s.explanation)).toBeInTheDocument();
      expect(within(card).getByTestId('risk-badge')).toHaveTextContent('safe');
      const code = within(card).getByTestId('command-text');
      expect(code.tagName).toBe('CODE');
      expect(code.closest('pre')).toHaveClass('font-mono');
    });
  });
});

describe('Risk display', () => {
  it('risk badges show text labels with emerald/amber/rose colors (17.4, 22.7, 11.23)', () => {
    const plan = validatedPlan();
    render(<RecoveryPlan steps={plan.recoverySteps} />);
    for (const s of plan.recoverySteps) {
      const badge = within(cardFor(s.command)).getByTestId('risk-badge');
      expect(badge).toHaveTextContent(s.riskLevel);
      for (const cls of RISK_BADGE_CLASSES[s.riskLevel].split(' ')) expect(badge).toHaveClass(cls);
    }
    expect(RISK_BADGE_CLASSES.safe).toContain('emerald');
    expect(RISK_BADGE_CLASSES.caution).toContain('amber');
    expect(RISK_BADGE_CLASSES.destructive).toContain('rose');
    expect(within(cardFor('git reset --hard HEAD~1')).getByTestId('risk-badge')).toHaveTextContent('destructive');
    expect(within(cardFor('git push --force-with-lease origin feature')).getByTestId('risk-badge')).toHaveTextContent('caution');
  });

  it('shows rose callout for destructive and amber callout for caution with the full warning (11.17, 11.18)', () => {
    const plan = validatedPlan();
    render(<RecoveryPlan steps={plan.recoverySteps} />);
    const reset = plan.recoverySteps.find((s) => s.command === 'git reset --hard HEAD~1')!;
    const lease = plan.recoverySteps.find((s) => s.command.startsWith('git push'))!;
    const resetCallout = within(cardFor(reset.command)).getByTestId('warning-callout');
    const leaseCallout = within(cardFor(lease.command)).getByTestId('warning-callout');
    expect(resetCallout).toHaveClass('border-rose-400/40');
    expect(resetCallout).toHaveTextContent(reset.warningMessage!);
    expect(leaseCallout).toHaveClass('border-amber-400/40');
    expect(leaseCallout).toHaveTextContent(lease.warningMessage!);
    expect(within(cardFor('git status')).queryByTestId('warning-callout')).toBeNull();
  });

  it('shows the residual risk badge, backup prerequisite label, and manual-run reminder on risky steps only (11.19, 17.5, 18.7)', () => {
    const plan = validatedPlan();
    render(<RecoveryPlan steps={plan.recoverySteps} />);
    for (const s of plan.recoverySteps) {
      const card = cardFor(s.command);
      if (s.riskLevel === 'safe') {
        expect(within(card).queryByTestId('residual-risk-badge')).toBeNull();
        expect(within(card).queryByTestId('manual-run-reminder')).toBeNull();
        expect(within(card).queryByTestId('backup-prerequisite')).toBeNull();
      } else {
        expect(within(card).getByTestId('residual-risk-badge')).toHaveTextContent(RESIDUAL_RISK_LABEL);
        expect(within(card).getByTestId('manual-run-reminder')).toHaveTextContent(MANUAL_RUN_REMINDER);
        const prereq = within(card).getByTestId('backup-prerequisite');
        expect(prereq).toHaveTextContent(/run these first/i);
        expect(prereq).toHaveTextContent(s.backupPrerequisite!);
      }
    }
    expect(within(cardFor('git reset --hard HEAD~1')).getByTestId('backup-prerequisite')).toHaveTextContent(
      'git status then git stash push -u',
    );
  });

  it('renders zero overclaim phrases on risky steps, including with a complete safeguard window (11.23)', () => {
    for (const plan of [validatedPlan(), completeWindowPlan()]) {
      const { unmount } = render(<RecoveryPlan steps={plan.recoverySteps} />);
      const risky = plan.recoverySteps.filter((s) => s.riskLevel !== 'safe');
      expect(risky.length).toBeGreaterThan(0);
      for (const s of risky) {
        const card = cardFor(s.command);
        expect(containsOverclaim(card.textContent ?? '')).toBe(false);
        expect(within(card).getByTestId('risk-badge').textContent).toMatch(/^(caution|destructive)$/);
      }
      unmount();
    }
    // Complete window: nothing inserted, input warning still shown.
    const complete = completeWindowPlan();
    expect(complete.recoverySteps).toHaveLength(3);
    render(<RecoveryPlan steps={complete.recoverySteps} />);
    expect(within(cardFor('git reset --hard HEAD~1')).getByTestId('warning-callout')).toHaveTextContent('Check your work first.');
  });
});

describe('Copy command controls', () => {
  it('copies the exact command and shows "Copied" for 2 seconds (18.1, 18.2, 18.3)', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const command = 'git log --oneline "HEAD..origin/feature"';
    render(<RecoveryPlan steps={[step(1, command)]} writeText={writeText} />);
    const button = screen.getByRole('button', { name: 'Copy command' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(command);
    expect(button).toHaveTextContent('Copied');
    act(() => {
      vi.advanceTimersByTime(COPIED_DURATION_MS - 1);
    });
    expect(button).toHaveTextContent('Copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(button).not.toHaveTextContent('Copied');
    expect(button).toHaveTextContent('Copy');
    expect(COPIED_DURATION_MS).toBe(2000);
  });

  it('shows the manual-copy failure message when the clipboard write fails (18.4)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    render(<RecoveryPlan steps={[step(1, 'git status')]} writeText={writeText} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(COPY_FAILED_MESSAGE);
    expect(COPY_FAILED_MESSAGE).toMatch(/copying failed/i);
    expect(COPY_FAILED_MESSAGE).toMatch(/manually/i);
  });

  it('presents commands as read-only selectable text with only a copy control (18.6, 22.6)', () => {
    const plan = validatedPlan();
    render(<RecoveryPlan steps={plan.recoverySteps} />);
    for (const card of cards()) {
      const buttons = within(card).getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAccessibleName('Copy command');
      const code = within(card).getByTestId('command-text');
      expect(code.closest('pre')).toHaveClass('select-text');
      expect(within(card).queryAllByRole('textbox')).toHaveLength(0);
    }
    expect(screen.queryAllByRole('button', { name: /run|execute|terminal/i })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Copy command' })).toHaveLength(plan.recoverySteps.length);
  });
});
