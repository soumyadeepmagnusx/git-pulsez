// Feature: gitpulse-recovery-assistant, Property 28: Invalid stored history is discarded
/**
 * For any stored value that is not valid JSON or fails history validation
 * (wrong version, more than 10 entries, malformed entries, invalid
 * Analysis_Results), `load()` returns an empty list and removes the stored key.
 *
 * **Validates: Requirements 20.7**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arbHistoryEntries } from '../arbitraries';
import {
  HISTORY_KEY,
  createHistoryStore,
  parseHistory,
  type HistoryStorage,
} from '../../src/lib/history/historyStore';
import { isHistoryEntry } from '../../src/shared/analysisContract';

/**
 * Reference validity check written from the design's StoredHistory definition,
 * used only to guarantee the generators never produce valid history.
 */
function isValidStoredHistoryRef(raw: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== 2 || keys[0] !== 'entries' || keys[1] !== 'version') return false;
  if (obj.version !== 1) return false;
  if (!Array.isArray(obj.entries) || obj.entries.length > 10) return false;
  return obj.entries.every((e) => isHistoryEntry(e));
}

type Json = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Mutations that each make a single History_Entry invalid. */
const entryMutations: ReadonlyArray<(e: Json) => void> = [
  (e) => delete e.id,
  (e) => (e.id = 42),
  (e) => delete e.incidentText,
  (e) => (e.incidentText = null),
  (e) => (e.createdAt = 'yesterday'),
  (e) => (e.createdAt = Number.POSITIVE_INFINITY), // serializes to null
  (e) => (e.createdAt = Number.NaN), // serializes to null
  (e) => delete e.createdAt,
  (e) => (e.result = {}),
  (e) => (e.result = null),
  (e) => ((e.result as Json).analysisMode = 'cloud_magic'),
  (e) => ((e.result as Json).incidentType = 'not_a_type'),
  (e) => ((e.result as Json).confidence = 'certain'),
  (e) => ((e.result as Json).recoverySteps = []),
  (e) => (((e.result as Json).recoverySteps as Json[])[0].stepNumber = 99),
  (e) => (((e.result as Json).recoverySteps as Json[])[0].riskLevel = 'harmless'),
  (e) => ((e.result as Json).extraResultKey = true),
  (e) => (e.unknownKey = 'x'),
  (e) => (e.fallbackReason = 'bedrock_sleeping'),
  (e) => (e.fallbackReason = 7),
];

const arbMutatedEntriesRaw: fc.Arbitrary<string> = arbHistoryEntries({ minLength: 1 }).chain((entries) =>
  fc
    .tuple(fc.nat({ max: entries.length - 1 }), fc.nat({ max: entryMutations.length - 1 }))
    .map(([index, mutation]) => {
      const list = clone(entries) as unknown as Json[];
      entryMutations[mutation](list[index]);
      return JSON.stringify({ version: 1, entries: list });
    }),
);

const arbWrongVersionRaw: fc.Arbitrary<string> = fc
  .tuple(
    arbHistoryEntries(),
    fc.oneof(
      fc.integer().filter((v) => v !== 1),
      fc.constantFrom<unknown>('1', null, true, 1.5, [1], { v: 1 }),
    ),
  )
  .map(([entries, version]) => JSON.stringify({ version, entries }));

const arbTooManyRaw: fc.Arbitrary<string> = arbHistoryEntries({ minLength: 11, maxLength: 14 }).map((entries) =>
  JSON.stringify({ version: 1, entries }),
);

const arbBadShapeRaw: fc.Arbitrary<string> = fc.oneof(
  arbHistoryEntries().map((entries) => JSON.stringify({ version: 1, entries, extra: 1 })),
  arbHistoryEntries().map((entries) => JSON.stringify({ entries })),
  arbHistoryEntries().map((entries) => JSON.stringify(entries)),
  fc.jsonValue().map((entries) => JSON.stringify({ version: 1, entries })),
);

const arbInvalidRaw: fc.Arbitrary<string> = fc
  .oneof(
    fc.string(),
    fc.jsonValue().map((v) => JSON.stringify(v)),
    arbWrongVersionRaw,
    arbTooManyRaw,
    arbBadShapeRaw,
    arbMutatedEntriesRaw,
  )
  .filter((raw) => !isValidStoredHistoryRef(raw));

function memoryStorage(initial: string, removeThrows = false): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>([[HISTORY_KEY, initial]]);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => {
      if (removeThrows) throw new Error('removeItem failed');
      data.delete(key);
    },
  };
}

describe('Property 28: Invalid stored history is discarded', () => {
  it('parseHistory rejects invalid data; load() returns [] and removes the key', () => {
    fc.assert(
      fc.property(arbInvalidRaw, (raw) => {
        expect(parseHistory(raw)).toBeNull();

        const storage = memoryStorage(raw);
        expect(createHistoryStore(storage).load()).toEqual([]);
        expect(storage.data.has(HISTORY_KEY)).toBe(false);

        const throwing = memoryStorage(raw, true);
        let loaded: unknown;
        expect(() => {
          loaded = createHistoryStore(throwing).load();
        }).not.toThrow();
        expect(loaded).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
