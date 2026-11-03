/// <reference types="node" />
/**
 * Unit tests for `scripts/check-dist-secrets.mjs` (Req 24.6).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, scanForSecrets } from '../../scripts/check-dist-secrets.mjs';

// Built at runtime so this test file itself never contains a key-shaped literal.
const FAKE_KEY = 'AKIA' + 'ABCDEFGHIJ234567';

const dirs: string[] = [];
function tempDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitpulse-dist-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('check-dist-secrets', () => {
  it('reports a key-shaped string in a nested file and exits with code 1', () => {
    const dir = tempDist({
      'index.html': '<html></html>',
      'assets/index-abc.js': `const a=1;\nconst k="${FAKE_KEY}";`,
    });
    const matches = scanForSecrets(dir);
    expect(matches).toHaveLength(1);
    expect(matches[0].file.replace(/\\/g, '/')).toBe('assets/index-abc.js');
    expect(matches[0].line).toBe(2);
    expect(matches[0].redacted).toBe('AKIA****************');

    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((msg: string) => void errors.push(msg));
    expect(main(dir)).toBe(1);
    expect(errors.join('\n')).not.toContain(FAKE_KEY);
  });

  it('returns no matches and exit code 0 for a clean directory', () => {
    const dir = tempDist({
      'index.html': '<html><body>AKIA-not-a-key akia1234567890123456</body></html>',
      'assets/app.js': 'console.log("AKIA123");',
    });
    expect(scanForSecrets(dir)).toEqual([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(dir)).toBe(0);
  });

  it('exits with code 2 when the directory does not exist', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(join(tmpdir(), 'gitpulse-missing-dist-dir-xyz'))).toBe(2);
  });
});
