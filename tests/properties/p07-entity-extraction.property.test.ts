// Feature: gitpulse-recovery-assistant, Property 7: Entity extraction
/**
 * For any generated conflicted file paths, commit hashes, and reflog lines
 * embedded in matching output (`Merge conflict in <path>`, `onto <hash>`,
 * `<hash> HEAD@{n}: <message>`), every path, every hash, and every reflog line
 * appears in detectedEvidence.
 *
 * **Validates: Requirements 4.2, 6.3, 7.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import {
  arbCommitHash,
  arbNoiseLine,
  arbPath,
  arbReflogLine,
  mergeConflictLine,
  rebaseOntoLine,
} from '../arbitraries';

const arbIndent = fc.constantFrom('', '  ', '\t');

/** Interleaves entity lines (kept in order, randomly indented) with noise lines. */
function arbWithNoise(entityLines: readonly string[]): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.array(fc.array(arbNoiseLine, { maxLength: 2 }), { minLength: entityLines.length + 1, maxLength: entityLines.length + 1 }),
      fc.array(arbIndent, { minLength: entityLines.length, maxLength: entityLines.length }),
    )
    .map(([noise, indents]) => {
      const lines: string[] = [];
      entityLines.forEach((line, i) => lines.push(...noise[i], indents[i] + line));
      lines.push(...noise[entityLines.length]);
      return lines.join('\n');
    });
}

describe('Property 7: Entity extraction', () => {
  it('every `Merge conflict in <path>` path appears in detectedEvidence', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(arbPath, { minLength: 1, maxLength: 5 })
          .chain((paths) => arbWithNoise(paths.map(mergeConflictLine)).map((text) => ({ paths, text }))),
        ({ paths, text }) => {
          const result = analyzeFallback(text);
          expect(result.incidentType).toBe('merge_conflict');
          for (const path of paths) expect(result.detectedEvidence).toContain(path);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every `onto <hash>` hash appears in detectedEvidence', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(arbCommitHash, { minLength: 1, maxLength: 3 })
          .chain((hashes) => arbWithNoise(hashes.map(rebaseOntoLine)).map((text) => ({ hashes, text }))),
        ({ hashes, text }) => {
          const result = analyzeFallback(text);
          expect(result.incidentType).toBe('stuck_rebase');
          for (const hash of hashes) expect(result.detectedEvidence).toContain(hash);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every reflog line `<hash> HEAD@{n}: <message>` appears (trimmed) in detectedEvidence', () => {
    fc.assert(
      fc.property(
        fc
          .array(arbReflogLine, { minLength: 1, maxLength: 5 })
          .chain((lines) => arbWithNoise(lines).map((text) => ({ lines, text }))),
        ({ lines, text }) => {
          const result = analyzeFallback(text);
          expect(result.incidentType).toBe('lost_commits');
          for (const line of lines) expect(result.detectedEvidence).toContain(line.trim());
        },
      ),
      { numRuns: 100 },
    );
  });
});
