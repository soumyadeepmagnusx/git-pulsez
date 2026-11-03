/** One Recovery_Step card (Req 17.3, 11.17–11.19, 11.23, 17.5, 18.7). */

import type { RecoveryStep } from '../shared/analysisContract';
import { BackupPrerequisite } from './BackupPrerequisite';
import { CommandBlock } from './CommandBlock';
import { ManualRunReminder } from './ManualRunReminder';
import { ResidualRiskBadge } from './ResidualRiskBadge';
import { RiskBadge } from './RiskBadge';
import { WarningCallout } from './WarningCallout';

export interface RecoveryStepCardProps {
  step: RecoveryStep;
  writeText?: (text: string) => Promise<void>;
}

export function RecoveryStepCard({ step, writeText }: RecoveryStepCardProps) {
  return (
    <article
      data-testid="recovery-step"
      className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/20 font-mono text-sm font-semibold text-violet-300">
          {step.stepNumber}
        </span>
        <h3 className="text-base font-semibold text-slate-100">{step.title}</h3>
        <RiskBadge riskLevel={step.riskLevel} />
        <ResidualRiskBadge warningMessage={step.warningMessage} />
      </header>
      <p className="text-sm text-slate-300">{step.explanation}</p>
      <BackupPrerequisite backupPrerequisite={step.backupPrerequisite} />
      <CommandBlock command={step.command} writeText={writeText} />
      <ManualRunReminder riskLevel={step.riskLevel} />
      <WarningCallout riskLevel={step.riskLevel} warningMessage={step.warningMessage} />
    </article>
  );
}
