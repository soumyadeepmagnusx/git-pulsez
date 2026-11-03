// Feature: gitpulse-recovery-assistant, Property 3: Fixed priority resolution
/**
 * For any non-empty subset of supported incident types, combining one trigger
 * snippet per type (in any order, with noise) makes analyzeFallback return the
 * highest-priority type of the subset, and assumptions name every other type.
 *
 * **Validates: Requirements 8.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { analyzeFallback, alsoMatchesAssumption } from '../../src/lib/fallback/fallbackEngine';
import type { SupportedIncidentType } from '../../src/shared/analysisContract';
import { arbIncidentText } from '../arbitraries';

/** Reference priority order from the design (hard-coded on purpose). */
const REFERENCE_PRIORITY: readonly SupportedIncidentType[] = [
  'stuck_rebase',
  'merge_conflict',
  'lost_commits',
  'detached_head',
  'rejected_push',
];

describe('Property 3: Fixed priority resolution', () => {
  it('chooses the highest-priority matched type and records an assumption for each other match', () => {
    fc.assert(
      fc.property(arbIncidentText({ minTypes: 2 }), ({ text, includedTypes }) => {
        const matched = REFERENCE_PRIORITY.filter((t) => includedTypes.includes(t));
        const expected = matched[0];
        const result = analyzeFallback(text);

        expect(result.incidentType).toBe(expected);

        for (const other of matched.slice(1)) {
          expect(result.assumptions).toContain(alsoMatchesAssumption(other, expected));
        }
        for (const t of REFERENCE_PRIORITY.filter((x) => !includedTypes.includes(x))) {
          expect(result.assumptions.some((a) => a.includes(`The text also matches ${t};`))).toBe(false);
        }
        // The chosen type is never listed as an "also matches" type.
        expect(result.assumptions.some((a) => a.includes(`The text also matches ${expected};`))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
