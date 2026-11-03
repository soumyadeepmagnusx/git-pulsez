// Feature: gitpulse-recovery-assistant, Property 1: Incident text validation
/**
 * **Validates: Requirements 1.3, 1.4, 1.5**
 *
 * For any string `s`, `validateIncidentText(s)` returns `ok` if and only if
 * `s` contains at least 1 non-whitespace character and `s.length <= 20000`;
 * whitespace-only or empty strings return `empty`, and longer strings return
 * `too_long`. Submitting through `gitPulseReducer` follows the same verdict:
 * invalid text sets the validation message and never starts loading (the
 * Analyzer stays idle), valid text starts loading.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EMPTY_INCIDENT_MESSAGE,
  TOO_LONG_INCIDENT_MESSAGE,
  validateIncidentText,
} from '../../src/lib/input/validateIncidentText';
import { MAX_INCIDENT_CHARS } from '../../src/shared/analysisContract';
import { gitPulseReducer, initialGitPulseState } from '../../src/hooks/useGitPulse';

/** Every character that `String.prototype.trim` removes (ECMAScript WhiteSpace + LineTerminator). */
const TRIMMABLE_WHITESPACE = [
  ' ', '\t', '\n', '\v', '\f', '\r', '\u00a0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a',
  '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
];

const arbWhitespaceChar = fc.constantFrom(...TRIMMABLE_WHITESPACE);
const arbVisibleChar = fc.constantFrom(...'abcXYZ019-_:/[]{}@é漢'.split(''), '\u200b' /* zero-width space: not trimmed */);
const arbAnyChar = fc.oneof(arbWhitespaceChar, arbVisibleChar);

/** Empty and whitespace-only strings, including Unicode whitespace. */
const arbWhitespaceOnly = fc.array(arbWhitespaceChar, { maxLength: 40 }).map((cs) => cs.join(''));

/** Whitespace-only strings longer than the limit (still `empty`, not `too_long`). */
const arbLongWhitespaceOnly = fc
  .tuple(arbWhitespaceChar, fc.integer({ min: MAX_INCIDENT_CHARS - 10, max: MAX_INCIDENT_CHARS + 10 }))
  .map(([ch, n]) => ch.repeat(n));

/** Strings with lengths 19,990–20,010: a repeated filler plus a few random characters at random positions. */
const arbNearBoundary = fc
  .record({
    length: fc.integer({ min: MAX_INCIDENT_CHARS - 10, max: MAX_INCIDENT_CHARS + 10 }),
    filler: arbAnyChar,
    edits: fc.array(fc.tuple(fc.nat(), arbAnyChar), { maxLength: 5 }),
  })
  .map(({ length, filler, edits }) => {
    const chars = filler.repeat(length).split('');
    for (const [pos, ch] of edits) chars[pos % length] = ch;
    return chars.join('');
  });

/** Short arbitrary strings: full Unicode, and mixes weighted towards whitespace. */
const arbShort = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 60 }),
  fc.array(arbAnyChar, { maxLength: 60 }).map((cs) => cs.join('')),
);

const arbIncidentInput = fc.oneof(arbWhitespaceOnly, arbLongWhitespaceOnly, arbNearBoundary, arbShort);

type Expected = 'empty' | 'too_long' | 'ok';

function expectedVerdict(s: string): Expected {
  if (s.trim().length === 0) return 'empty';
  if (s.length > MAX_INCIDENT_CHARS) return 'too_long';
  return 'ok';
}

describe('Property 1: Incident text validation', () => {
  it('returns empty / too_long / ok exactly as the definition says, and submit follows the verdict', () => {
    fc.assert(
      fc.property(arbIncidentInput, (s) => {
        const expected = expectedVerdict(s);
        const result = validateIncidentText(s);

        if (expected === 'ok') {
          expect(result).toEqual({ ok: true });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: expected,
            message: expected === 'empty' ? EMPTY_INCIDENT_MESSAGE : TOO_LONG_INCIDENT_MESSAGE,
          });
        }

        const edited = gitPulseReducer(initialGitPulseState, { type: 'edit', text: s });
        const submitted = gitPulseReducer(edited, { type: 'submit' });
        if (expected === 'ok') {
          expect(submitted.status).toBe('loading');
          expect(submitted.validationMessage).toBeNull();
        } else {
          expect(submitted.status).not.toBe('loading');
          expect(submitted.validationMessage).toBe(
            expected === 'empty' ? EMPTY_INCIDENT_MESSAGE : TOO_LONG_INCIDENT_MESSAGE,
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it('uses the exact required messages', () => {
    expect(EMPTY_INCIDENT_MESSAGE).toBe('Incident text is required.');
    expect(TOO_LONG_INCIDENT_MESSAGE).toBe('Incident text must be 20,000 characters or fewer.');
  });
});
