/** Empty state shown while no Analysis_Result is displayed (Req 21.1). */

import { Terminal } from 'lucide-react';

export const EMPTY_STATE_MESSAGE =
  'Paste Git output or select a sample incident, then choose Analyze Incident to see a recovery plan.';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center">
      <Terminal className="h-8 w-8 text-cyan-400" aria-hidden="true" />
      <h2 className="text-base font-semibold text-slate-100">No analysis yet</h2>
      <p className="max-w-md text-sm text-slate-300">{EMPTY_STATE_MESSAGE}</p>
    </div>
  );
}
