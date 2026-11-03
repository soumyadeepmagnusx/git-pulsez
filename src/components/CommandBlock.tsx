/** Read-only, selectable terminal-styled command with a copy button as its only control (Req 18.6). */

import { CopyButton } from './CopyButton';

export interface CommandBlockProps {
  command: string;
  writeText?: (text: string) => Promise<void>;
}

export function CommandBlock({ command, writeText }: CommandBlockProps) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm text-cyan-200 select-text">
        <code data-testid="command-text">{command}</code>
      </pre>
      <CopyButton command={command} writeText={writeText} />
    </div>
  );
}
