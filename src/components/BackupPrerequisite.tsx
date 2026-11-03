/** Backup prerequisite with a "run first" label (Req 17.5). */

export interface BackupPrerequisiteProps {
  backupPrerequisite?: string;
}

export function BackupPrerequisite({ backupPrerequisite }: BackupPrerequisiteProps) {
  if (!backupPrerequisite) return null;
  return (
    <p data-testid="backup-prerequisite" className="text-sm text-slate-200">
      <span className="font-semibold text-cyan-300">Run these first:</span>{' '}
      <span className="font-mono text-slate-100">{backupPrerequisite}</span>
    </p>
  );
}
