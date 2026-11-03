// Feature: gitpulse-recovery-assistant, Property 27: History round trip
/**
 * For any valid list of at most 10 History_Entries, parseHistory(serializeHistory(list))
 * is deeply equal to the list, and a new store created over the same storage
 * loads the same list (simulating a page reload).
 *
 * **Validates: Requirements 20.6, 20.9**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { HistoryEntry } from '../../src/shared/analysisContract';
import {
  HISTORY_KEY,
  createHistoryStore,
  parseHistory,
  serializeHistory,
  type HistoryStorage,
} from '../../src/lib/history/historyStore';
import { arbHistoryEntries } from '../arbitraries';

function sortedDesc(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt);
}

function memoryStorage(initial: Record<string, string> = {}): HistoryStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe('Property 27: History round trip', () => {
  it('parseHistory(serializeHistory(list)) deep-equals the list', () => {
    fc.assert(
      fc.property(arbHistoryEntries(), (entries) => {
        const list = sortedDesc(entries);
        expect(parseHistory(serializeHistory(list))).toStrictEqual(list);
      }),
      { numRuns: 200 },
    );
  });

  it('round-trips entries that carry a fallbackReason', () => {
    const withReason = arbHistoryEntries({ minLength: 1 }).filter((es) =>
      es.some((e) => e.fallbackReason !== undefined),
    );
    fc.assert(
      fc.property(withReason, (entries) => {
        const list = sortedDesc(entries);
        const parsed = parseHistory(serializeHistory(list));
        expect(parsed).toStrictEqual(list);
        expect(parsed?.some((e) => e.fallbackReason !== undefined)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('a fresh store over pre-populated storage loads the same entries newest first', () => {
    fc.assert(
      fc.property(arbHistoryEntries(), (entries) => {
        const list = sortedDesc(entries);
        const storage = memoryStorage({ [HISTORY_KEY]: serializeHistory(list) });
        const loaded = createHistoryStore(storage).load();
        expect(loaded).toStrictEqual(list);
        // Valid data is kept, not discarded.
        expect(storage.data.get(HISTORY_KEY)).toBe(serializeHistory(list));
      }),
      { numRuns: 200 },
    );
  });

  it('entries saved through one store are loaded by a new store over the same storage', () => {
    fc.assert(
      fc.property(arbHistoryEntries(), (entries) => {
        const storage = memoryStorage();
        const writer = createHistoryStore(storage);
        let last: HistoryEntry[] = writer.load();
        for (const e of entries) last = writer.save(e).entries;
        const reloaded = createHistoryStore(storage).load();
        expect(reloaded).toStrictEqual(last);
        expect(reloaded).toStrictEqual(sortedDesc(entries));
      }),
      { numRuns: 100 },
    );
  });
});
