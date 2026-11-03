import { describe, expect, it } from 'vitest';
import {
  HISTORY_KEY,
  MAX_HISTORY,
  addEntry,
  createHistoryStore,
  parseHistory,
  serializeHistory,
  type HistoryStorage,
} from '../../src/lib/history/historyStore';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { SAMPLE_INCIDENTS } from '../../src/data/sampleIncidents';
import type { HistoryEntry } from '../../src/shared/analysisContract';

class MemoryStorage implements HistoryStorage {
  data = new Map<string, string>();
  failSet = false;
  failRemove = false;
  failGet = false;
  getItem(key: string): string | null {
    if (this.failGet) throw new Error('get failed');
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    if (this.failRemove) throw new Error('remove failed');
    this.data.delete(key);
  }
}

function makeEntry(n: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  const sample = SAMPLE_INCIDENTS[n % SAMPLE_INCIDENTS.length];
  return {
    id: `entry-${n}`,
    incidentText: sample.incidentText,
    result: analyzeFallback(sample.incidentText),
    createdAt: 1_700_000_000_000 + n * 1000,
    ...overrides,
  };
}

describe('History_Store save/load', () => {
  it('saves an entry and loads it back', () => {
    const storage = new MemoryStorage();
    const store = createHistoryStore(storage);
    expect(store.load()).toEqual([]);
    const entry = makeEntry(1, { fallbackReason: 'bedrock_timeout' });
    const { entries, persisted } = store.save(entry);
    expect(persisted).toBe(true);
    expect(entries).toEqual([entry]);
    expect(store.load()).toEqual([entry]);
    expect(storage.data.has(HISTORY_KEY)).toBe(true);
  });

  it('a fresh store over the same storage reloads persisted entries (20.6)', () => {
    const storage = new MemoryStorage();
    const first = createHistoryStore(storage);
    first.save(makeEntry(1));
    first.save(makeEntry(2));
    const second = createHistoryStore(storage);
    expect(second.load()).toEqual([makeEntry(2), makeEntry(1)]);
  });

  it('keeps entries newest first by createdAt', () => {
    const store = createHistoryStore(new MemoryStorage());
    store.save(makeEntry(5));
    store.save(makeEntry(1));
    const { entries } = store.save(makeEntry(3));
    expect(entries.map((e) => e.id)).toEqual(['entry-5', 'entry-3', 'entry-1']);
  });

  it('the 11th entry drops the oldest (20.2)', () => {
    const storage = new MemoryStorage();
    const store = createHistoryStore(storage);
    let entries: HistoryEntry[] = [];
    for (let i = 1; i <= MAX_HISTORY + 1; i++) entries = store.save(makeEntry(i)).entries;
    expect(entries).toHaveLength(10);
    expect(entries.map((e) => e.id)).not.toContain('entry-1');
    expect(entries[0].id).toBe('entry-11');
    expect(entries[9].id).toBe('entry-2');
    expect(createHistoryStore(storage).load()).toEqual(entries);
  });

  it('addEntry is pure and caps at 10', () => {
    const base = Array.from({ length: 10 }, (_, i) => makeEntry(10 - i));
    const copy = [...base];
    const next = addEntry(base, makeEntry(20));
    expect(base).toEqual(copy);
    expect(next).toHaveLength(10);
    expect(next[0].id).toBe('entry-20');
  });

  it('write failure returns persisted: false and keeps the entries (20.8)', () => {
    const storage = new MemoryStorage();
    storage.failSet = true;
    const store = createHistoryStore(storage);
    const entry = makeEntry(1);
    const result = store.save(entry);
    expect(result.persisted).toBe(false);
    expect(result.entries).toEqual([entry]);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
  });

  it('clear removes the key (20.5)', () => {
    const storage = new MemoryStorage();
    const store = createHistoryStore(storage);
    store.save(makeEntry(1));
    store.clear();
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
    expect(store.load()).toEqual([]);
    expect(store.save(makeEntry(2)).entries).toEqual([makeEntry(2)]);
  });

  it('a getItem failure loads an empty list', () => {
    const storage = new MemoryStorage();
    storage.failGet = true;
    expect(createHistoryStore(storage).load()).toEqual([]);
  });
});

describe('History_Store invalid stored data (20.7)', () => {
  const invalidValues: Array<[string, string]> = [
    ['invalid JSON', '{not json'],
    ['a JSON array', '[]'],
    ['null JSON', 'null'],
    ['wrong version', JSON.stringify({ version: 2, entries: [] })],
    ['missing entries', JSON.stringify({ version: 1 })],
    ['extra key', JSON.stringify({ version: 1, entries: [], extra: true })],
    ['entries not an array', JSON.stringify({ version: 1, entries: {} })],
    ['malformed entry', JSON.stringify({ version: 1, entries: [{ id: 1 }] })],
    [
      'invalid Analysis_Result',
      JSON.stringify({
        version: 1,
        entries: [{ ...makeEntry(1), result: { ...makeEntry(1).result, recoverySteps: [] } }],
      }),
    ],
  ];

  it.each(invalidValues)('discards %s and removes the key', (_label, raw) => {
    const storage = new MemoryStorage();
    storage.data.set(HISTORY_KEY, raw);
    expect(createHistoryStore(storage).load()).toEqual([]);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
  });

  it('ignores removeItem errors during cleanup', () => {
    const storage = new MemoryStorage();
    storage.data.set(HISTORY_KEY, '{not json');
    storage.failRemove = true;
    const store = createHistoryStore(storage);
    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual([]);
  });
});

describe('parseHistory / serializeHistory', () => {
  it('round-trips a valid list', () => {
    const list = [makeEntry(3), makeEntry(2, { fallbackReason: 'bedrock_error' }), makeEntry(1)];
    expect(parseHistory(serializeHistory(list))).toEqual(list);
  });

  it('returns null for null input', () => {
    expect(parseHistory(null)).toBeNull();
  });

  it('rejects a wrong version', () => {
    expect(parseHistory(JSON.stringify({ version: 2, entries: [makeEntry(1)] }))).toBeNull();
  });

  it('rejects more than 10 entries', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => makeEntry(i));
    expect(parseHistory(serializeHistory(eleven))).toBeNull();
    expect(parseHistory(serializeHistory(eleven.slice(0, 10)))).toHaveLength(10);
  });

  it('rejects an invalid fallbackReason and a non-finite createdAt', () => {
    const bad = { ...makeEntry(1), fallbackReason: 'nope' };
    expect(parseHistory(JSON.stringify({ version: 1, entries: [bad] }))).toBeNull();
    const raw = JSON.stringify({ version: 1, entries: [makeEntry(1)] }).replace(
      /"createdAt":\d+/,
      '"createdAt":"soon"',
    );
    expect(parseHistory(raw)).toBeNull();
  });
});
