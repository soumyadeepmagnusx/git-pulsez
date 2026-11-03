// Feature: gitpulse-recovery-assistant, Property 2: Trigger detection
/**
 * **Validates: Requirements 3.1, 4.1, 5.1, 6.1, 7.1**
 *
 * For any supported incident type `T`, any trigger snippet of `T`, and any
 * surrounding noise text that contains no trigger of another type,
 * `analyzeFallback` returns `incidentType` equal to `T`.
 *
 * The test draws triggers two ways: realistic terminal-output snippets from
 * the shared arbitraries, and each individual trigger string from the design's
 * trigger table embedded in noise. `rejected_push` needs `[rejected]` AND a
 * reason, so either part alone does not detect it. Lost-commit descriptions
 * are matched case-insensitively.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { analyzeFallback } from '../../src/lib/fallback/fallbackEngine';
import { detectIncidentTypes } from '../../src/lib/fallback/patterns';
import { SUPPORTED_INCIDENT_TYPES, type SupportedIncidentType } from '../../src/shared/analysisContract';
import { arbNoiseLine, arbNoiseText, arbSingleTypeIncidentText } from '../arbitraries';

const RUNS = { numRuns: 200 };

/** Individual trigger strings from the design's trigger table (case-sensitive ones). */
const ANY_OF: Record<Exclude<SupportedIncidentType, 'rejected_push'>, readonly string[]> = {
  merge_conflict: ['CONFLICT (', 'Automatic merge failed', 'fix conflicts and then commit'],
  detached_head: ['detached HEAD', 'HEAD detached at', 'HEAD detached from'],
  stuck_rebase: ['rebase in progress', 'interactive rebase in progress', 'git rebase --continue', 'could not apply'],
  lost_commits: ['reset: moving to', 'HEAD@{', 'git reset --hard'],
};

const LOST_COMMIT_DESCRIPTIONS = [
  'lost commit',
  'lost my commit',
  'commits are gone',
  'commits disappeared',
  'commit disappeared',
  'undo a reset',
  'undo reset',
] as const;

const REJECTED_REASONS = ['non-fast-forward', 'fetch first', 'Updates were rejected'] as const;

/** Random upper/lower casing of each character. */
function arbRandomCase(s: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((flags) => s.split('').map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase())).join(''));
}

/** Embeds `snippet` in a line with noise before/after it and noise lines around. */
function arbEmbedded(snippet: string): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.array(arbNoiseLine, { maxLength: 3 }),
      fc.constantFrom('', 'output ', '  '),
      fc.constantFrom('', ' done', ' now'),
      fc.array(arbNoiseLine, { maxLength: 3 }),
    )
    .map(([before, pre, post, after]) => [...before, pre + snippet + post, ...after].join('\n'));
}

/** A trigger snippet (individual trigger string) plus its expected type. */
const arbIndividualTrigger: fc.Arbitrary<{ type: SupportedIncidentType; snippet: string }> = fc.oneof(
  ...(Object.keys(ANY_OF) as (keyof typeof ANY_OF)[]).map((type) =>
    fc.constantFrom(...ANY_OF[type]).map((snippet) => ({ type: type as SupportedIncidentType, snippet })),
  ),
  fc
    .constantFrom(...LOST_COMMIT_DESCRIPTIONS)
    .chain(arbRandomCase)
    .map((snippet) => ({ type: 'lost_commits' as const, snippet })),
  fc
    .tuple(fc.constantFrom(...REJECTED_REASONS), fc.boolean())
    .map(([reason, markerFirst]) => ({
      type: 'rejected_push' as const,
      snippet: markerFirst ? `[rejected] main -> main (${reason})` : `${reason} [rejected]`,
    })),
);

describe('Property 2: Trigger detection', () => {
  it('a trigger snippet of type T in noise makes analyzeFallback return T', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbSingleTypeIncidentText().map((g) => ({ type: g.includedTypes[0], text: g.text })),
          arbIndividualTrigger.chain(({ type, snippet }) => arbEmbedded(snippet).map((text) => ({ type, text }))),
        ),
        ({ type, text }) => {
          expect(detectIncidentTypes(text)).toEqual([type]);
          expect(analyzeFallback(text).incidentType).toBe(type);
        },
      ),
      RUNS,
    );
  });

  it('rejected_push needs both [rejected] and a reason', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('[rejected] main -> main'), fc.constantFrom(...REJECTED_REASONS)).chain(arbEmbedded),
        (text) => {
          expect(detectIncidentTypes(text)).not.toContain('rejected_push');
          expect(analyzeFallback(text).incidentType).toBe('unknown');
        },
      ),
      RUNS,
    );
  });

  it('noise text alone matches no supported type', () => {
    fc.assert(
      fc.property(arbNoiseText(), (text) => {
        expect(detectIncidentTypes(text)).toEqual([]);
        expect(SUPPORTED_INCIDENT_TYPES).not.toContain(analyzeFallback(text).incidentType);
      }),
      RUNS,
    );
  });
});
