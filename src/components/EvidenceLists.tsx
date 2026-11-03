/** "Detected Evidence" and "Assumptions" lists with empty placeholders (Req 10.3, 10.4). */

import { FileSearch, HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const EMPTY_LIST_PLACEHOLDER = 'No entries available.';

export interface EvidenceListsProps {
  detectedEvidence: string[];
  assumptions: string[];
}

interface LabeledListProps {
  id: string;
  heading: string;
  items: string[];
  icon: LucideIcon;
  mono: boolean;
}

function LabeledList({ id, heading, items, icon: Icon, mono }: LabeledListProps) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 id={headingId} className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
        <Icon className="h-4 w-4 text-cyan-400" aria-hidden="true" />
        {heading}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm italic text-slate-300">{EMPTY_LIST_PLACEHOLDER}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              key={`${index}-${item}`}
              className={`whitespace-pre-wrap break-words rounded-md bg-slate-950 px-3 py-2 text-sm text-slate-200 ${
                mono ? 'font-mono' : ''
              }`}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EvidenceLists({ detectedEvidence, assumptions }: EvidenceListsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <LabeledList id="detected-evidence" heading="Detected Evidence" items={detectedEvidence} icon={FileSearch} mono />
      <LabeledList id="assumptions" heading="Assumptions" items={assumptions} icon={HelpCircle} mono={false} />
    </div>
  );
}
