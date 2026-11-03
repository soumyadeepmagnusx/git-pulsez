// Feature: gitpulse-recovery-assistant, Property 6: Evidence is grounded in the input
/**
 * For any Incident_Text, every entry in the Fallback_Engine's detectedEvidence
 * is a non-empty exact substring of the Incident_Text, and entries are unique.
 *
 * **Validates: Requirements 10.1**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { SUPPORTED_INCIDENT_TYPES } from '../../src/shared/analysisContract';
import { arbIncidentText, arbPlainLanguageText, arbTriggerSnippet } from '../arbitraries';

function assertGrounded(text: string): void {
  const { detectedEvidence } = analyzeFallback(text);
  for (const entry of detectedEvidence) {
    expect(entry.length).toBeGreaterThan(0);
    expect(text.includes(entry)).toBe(true);
  }
  expect(new Set(detectedEvidence).size).toBe(detectedEvidence.length);
}

/** Variants of a generated text: CRLF line endings and extra whitespace around lines. */
const arbTextVariant = (text: string): fc.Arbitrary<string> =>
  fc
    .tuple(fc.boolean(), fc.constantFrom('', ' ', '\t', '   '), fc.constantFrom('', ' ', '\t', '  '))
    .map(([crlf, lead, trail]) => {
      const lines = text.split('\n').map((l) => lead + l + trail);
      return lines.join(crlf ? '\r\n' : '\n');
    });

const arbAnyTriggerSnippet = fc.constantFrom(...SUPPORTED_INCIDENT_TYPES).chain(arbTriggerSnippet);

const arbUnicode = fc.oneof(fc.string({ unit: 'binary', maxLength: 200 }), fc.string({ unit: 'grapheme', maxLength: 200 }));

describe('Property 6: Evidence is grounded in the input', () => {
  it('holds for generated incident texts (single and multiple types, CRLF, padded lines)', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbIncidentText({ minTypes: 1, maxTypes: 1 }), arbIncidentText({ minTypes: 2 })).chain((g) => arbTextVariant(g.text)),
        assertGrounded,
      ),
      { numRuns: 200 },
    );
  });

  it('holds for plain-language texts', () => {
    fc.assert(
      fc.property(arbPlainLanguageText().chain((g) => arbTextVariant(g.text)), assertGrounded),
      { numRuns: 100 },
    );
  });

  it('holds for arbitrary unicode strings, optionally combined with trigger snippets', () => {
    fc.assert(
      fc.property(
        arbUnicode,
        fc.option(arbAnyTriggerSnippet, { nil: undefined }),
        arbUnicode,
        fc.constantFrom('', '\n', '\r\n', ' '),
        (prefix, snippet, suffix, sep) => {
          const text = snippet === undefined ? prefix : [prefix, snippet, suffix].join(sep);
          assertGrounded(text);
        },
      ),
      { numRuns: 300 },
    );
  });
});
