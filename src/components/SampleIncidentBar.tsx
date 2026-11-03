/**
 * Sample_Incident buttons (Req 2.1–2.4, 22.5).
 *
 * One button per sample; the active sample is marked with aria-pressed and
 * accent styling. The parent clears `activeSampleId` when the user edits the text.
 */

import { FlaskConical } from 'lucide-react';
import type { SampleIncident } from '../data/sampleIncidents';
import type { SupportedIncidentType } from '../shared/analysisContract';

export interface SampleIncidentBarProps {
  samples: readonly SampleIncident[];
  activeSampleId: SupportedIncidentType | null;
  onSelect: (id: SupportedIncidentType) => void;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';

export function SampleIncidentBar({ samples, activeSampleId, onSelect }: SampleIncidentBarProps) {
  return (
    <section
      aria-labelledby="sample-incidents-heading"
      className="rounded-xl border border-slate-800 bg-slate-900 p-4"
    >
      <h2
        id="sample-incidents-heading"
        className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100"
      >
        <FlaskConical className="h-4 w-4 text-violet-400" aria-hidden="true" />
        Sample incidents
      </h2>
      <div className="flex flex-wrap gap-2">
        {samples.map((sample) => {
          const active = sample.id === activeSampleId;
          return (
            <button
              key={sample.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(sample.id)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${FOCUS_RING} ${
                active
                  ? 'border-violet-400 bg-violet-400/15 text-violet-200'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-cyan-400 hover:text-cyan-200'
              }`}
            >
              {sample.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
