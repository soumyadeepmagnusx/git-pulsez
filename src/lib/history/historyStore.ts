/**
 * History_Store: persists the 10 most recent History_Entries in localStorage
 * (Req 20.1, 20.2, 20.5–20.9). Storage is injected so tests can use an
 * in-memory implementation.
 */
import { isHistoryEntry, type HistoryEntry, type StoredHistory } from '../../shared/analysisContract';

export const HISTORY_KEY = 'gitpulse.history.v1';
export const MAX_HISTORY = 10;

export type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SaveResult {
  entries: HistoryEntry[];
  persisted: boolean;
}

export interface HistoryStore {
  /** Newest first. Invalid stored data → [] and the key is removed (Req 20.6, 20.7). */
  load(): HistoryEntry[];
  /** Adds the entry and writes to storage; write failures return `persisted: false` (Req 20.8). */
  save(entry: HistoryEntry): SaveResult;
  /** Removes all entries from storage (Req 20.5). */
  clear(): void;
}

/** Stable sort by `createdAt` descending; does not mutate the input. */
function sortNewestFirst(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt);
}

/** Pure: prepend, sort by `createdAt` desc (stable), keep the newest 10 (Req 20.1, 20.2). */
export function addEntry(entries: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return sortNewestFirst([entry, ...entries]).slice(0, MAX_HISTORY);
}

export function serializeHistory(entries: readonly HistoryEntry[]): string {
  const stored: StoredHistory = { version: 1, entries: [...entries] };
  return JSON.stringify(stored);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Parses stored history. Returns `null` for anything invalid: non-JSON, a
 * non-plain object, extra top-level keys, wrong version, more than 10
 * entries, or any entry failing `isHistoryEntry`. Valid entries are returned
 * newest first.
 */
export function parseHistory(raw: string | null): HistoryEntry[] | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('version') || !keys.includes('entries')) return null;
  if (value.version !== 1) return null;
  const entries = value.entries;
  if (!Array.isArray(entries) || entries.length > MAX_HISTORY) return null;
  if (!entries.every((entry) => isHistoryEntry(entry))) return null;
  return sortNewestFirst(entries as HistoryEntry[]);
}

export function createHistoryStore(storage: HistoryStorage): HistoryStore {
  let current: HistoryEntry[] | null = null;

  function removeKeyQuietly(): void {
    try {
      storage.removeItem(HISTORY_KEY);
    } catch {
      // Removal errors are ignored (Req 20.7).
    }
  }

  function load(): HistoryEntry[] {
    let raw: string | null;
    try {
      raw = storage.getItem(HISTORY_KEY);
    } catch {
      current = [];
      return [];
    }
    if (raw === null) {
      current = [];
      return [];
    }
    const parsed = parseHistory(raw);
    if (parsed === null) {
      removeKeyQuietly();
      current = [];
      return [];
    }
    current = parsed;
    return [...parsed];
  }

  function save(entry: HistoryEntry): SaveResult {
    const base = current ?? load();
    const entries = addEntry(base, entry);
    current = entries;
    let persisted = true;
    try {
      storage.setItem(HISTORY_KEY, serializeHistory(entries));
    } catch {
      persisted = false;
    }
    return { entries: [...entries], persisted };
  }

  function clear(): void {
    current = [];
    removeKeyQuietly();
  }

  return { load, save, clear };
}
