/** Copy-only command control (Req 18.1–18.4, 22.6). */

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export const COPY_FAILED_MESSAGE = 'Copying failed. Select the command text and copy it manually.';
export const COPIED_DURATION_MS = 2000;

export interface CopyButtonProps {
  command: string;
  /** Injected clipboard writer for tests; defaults to `navigator.clipboard.writeText`. */
  writeText?: (text: string) => Promise<void>;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';

function defaultWriteText(): ((text: string) => Promise<void>) | undefined {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return undefined;
  return (text) => navigator.clipboard.writeText(text);
}

export function CopyButton({ command, writeText }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const write = writeText ?? defaultWriteText();
    try {
      if (!write) throw new Error('Clipboard unavailable');
      await write(command);
      if (!mountedRef.current) return;
      setState('copied');
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (mountedRef.current) setState('idle');
      }, COPIED_DURATION_MS);
    } catch {
      if (mountedRef.current) setState('failed');
    }
  };

  const copied = state === 'copied';
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label="Copy command"
        onClick={() => void handleCopy()}
        className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700 ${FOCUS_RING}`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {state === 'failed' && (
        <p role="alert" className="text-xs text-rose-300">
          {COPY_FAILED_MESSAGE}
        </p>
      )}
    </div>
  );
}
