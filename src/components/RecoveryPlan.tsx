/** Ordered recovery plan, sorted by stepNumber (Req 17.2). */

import type { RecoveryStep } from '../shared/analysisContract';
import { RecoveryStepCard } from './RecoveryStepCard';

export interface RecoveryPlanProps {
  steps: readonly RecoveryStep[];
  writeText?: (text: string) => Promise<void>;
}

export function RecoveryPlan({ steps, writeText }: RecoveryPlanProps) {
  const sorted = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  return (
    <section aria-labelledby="recovery-plan-heading" className="flex flex-col gap-3">
      <h2 id="recovery-plan-heading" className="text-lg font-semibold text-slate-100">
        Recovery Plan
      </h2>
      <ol className="flex flex-col gap-3">
        {sorted.map((step) => (
          <li key={step.stepNumber}>
            <RecoveryStepCard step={step} writeText={writeText} />
          </li>
        ))}
      </ol>
    </section>
  );
}
