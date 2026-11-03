/**
 * History_Entry arbitraries: valid entries with distinct `createdAt` values.
 */

import fc from 'fast-check';
import { FALLBACK_REASONS, type HistoryEntry } from '../../src/shared/analysisContract';
import { arbAnalysisResult } from './analysisResult';
import { arbSafeText } from './text';

const MIN_TIME = 1_600_000_000_000;
const MAX_TIME = 1_900_000_000_000;

/** A valid History_Entry with the given `createdAt` and `id`. */
export function arbHistoryEntryAt(createdAt: number, id: string): fc.Arbitrary<HistoryEntry> {
  return fc
    .tuple(
      arbSafeText({ maxWords: 12 }),
      arbAnalysisResult({ maxBlocks: 1, multiSegment: false }),
      fc.option(fc.constantFrom(...FALLBACK_REASONS), { nil: undefined }),
    )
    .map(([incidentText, result, reason]) => {
      const entry: HistoryEntry = { id, incidentText, result, createdAt };
      // A fallbackReason only accompanies fallback_demo results.
      if (reason !== undefined && result.analysisMode === 'fallback_demo') entry.fallbackReason = reason;
      return entry;
    });
}

/** A single valid History_Entry. */
export const arbHistoryEntry: fc.Arbitrary<HistoryEntry> = fc
  .integer({ min: MIN_TIME, max: MAX_TIME })
  .chain((t) => arbHistoryEntryAt(t, `entry-${t}`));

export interface HistoryEntriesOptions {
  minLength?: number;
  /** Default 10 (MAX_HISTORY). */
  maxLength?: number;
}

/** 0..10 valid History_Entries with distinct `createdAt` and `id` values, in random order. */
export function arbHistoryEntries(opts: HistoryEntriesOptions = {}): fc.Arbitrary<HistoryEntry[]> {
  const { minLength = 0, maxLength = 10 } = opts;
  return fc
    .uniqueArray(fc.integer({ min: MIN_TIME, max: MAX_TIME }), { minLength, maxLength })
    .chain((times) =>
      times.length === 0
        ? fc.constant<HistoryEntry[]>([])
        : fc.tuple(...times.map((t, i) => arbHistoryEntryAt(t, `entry-${i}-${t}`))),
    );
}
