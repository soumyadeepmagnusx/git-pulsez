// Feature: gitpulse-recovery-assistant, Property 26: History is capped and ordered
/**
 * For any sequence of saved History_Entries, the stored list has at most 10
 * entries, contains the most recent min(n, 10) entries, and is sorted by
 * `createdAt` descending.
 *
 * **Validates: Requirements 20.1, 20.2, 20.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { HistoryEntry } from '../../src/shared/analysisContract';
import {
  addEntry,
  createHistoryStore,
  parseHistory,
  HISTORY_KEY,
  MAX_HISTORY,
  type HistoryStorage,
} from '../../src/lib/history/historyStore';
import { arbHistoryEntries } from '../arbitraries';

function memoryStorage(): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
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

/** Reference model: all saved entries sorted newest first, keep the newest 10. */
function expected(saved: readonly HistoryEntry[]): HistoryEntry[] {
  return [...saved].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_HISTORY);
}

function assertSortedDesc(entries: readonly HistoryEntry[]): void {
  for (let i = 1; i < entries.length; i++) {
    expect(entries[i - 1].createdAt).toBeGreaterThan(entries[i].createdAt);
  }
}

// Up to 25 entries so sequences regularly exceed the cap; distinct createdAt, random order.
const arbSaveSequence = arbHistoryEntries({ minLength: 0, maxLength: 25 });

describe('Property 26: History is capped and ordered', () => {
  it('History_Store.save keeps the 10 newest entries, newest first', () => {
    fc.assert(
      fc.property(arbSaveSequence, (saved) => {
        const storage = memoryStorage();
        const store = createHistoryStore(storage);
        let last: HistoryEntry[] = store.load();
        saved.forEach((entry, i) => {
          const res = store.save(entry);
          expect(res.persisted).toBe(true);
          expect(res.entries.length).toBeLessThanOrEqual(MAX_HISTORY);
          assertSortedDesc(res.entries);
          expect(res.entries).toEqual(expected(saved.slice(0, i + 1)));
          last = res.entries;
        });

        const want = expected(saved);
        expect(last).toEqual(want);
        expect(last.length).toBe(Math.min(saved.length, MAX_HISTORY));

        // What is persisted matches, and a fresh store over the same storage loads it.
        if (saved.length > 0) {
          expect(parseHistory(storage.data.get(HISTORY_KEY) ?? null)).toEqual(want);
        }
        expect(createHistoryStore(storage).load()).toEqual(want);
      }),
      { numRuns: 100 },
    );
  });

  it('pure addEntry obeys the same reference model', () => {
    fc.assert(
      fc.property(arbSaveSequence, (saved) => {
        let entries: HistoryEntry[] = [];
        saved.forEach((entry, i) => {
          entries = addEntry(entries, entry);
          expect(entries.length).toBeLessThanOrEqual(MAX_HISTORY);
          assertSortedDesc(entries);
          expect(entries).toEqual(expected(saved.slice(0, i + 1)));
        });
        expect(entries).toEqual(expected(saved));
      }),
      { numRuns: 100 },
    );
  });
});
