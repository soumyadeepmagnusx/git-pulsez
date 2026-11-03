// Feature: gitpulse-recovery-assistant, Property 14: Warnings are preserved and complete
/**
 * **Validates: Requirements 11.4, 11.5, 11.6, 11.13, 11.21, 12.2, 12.3, 12.5, 12.9, 12.10, 12.11, 13.2, 13.3, 13.4, 14.3, 14.4, 14.5, 14.11, 14.12, 15.2, 15.3**
 *
 * For any Risky_Step with any input warning (containing the Residual_Risk_Label
 * at most once) and any Safeguard_Window content, the output warning keeps the
 * input text unchanged as a prefix, contains every command-specific warning
 * text for every contained Risky_Command, and contains the label exactly once.
 * Non-risky steps with a non-empty input warning keep it unchanged.
 *
 * Expected texts come from the generator's reference model (ExpectedRisky) and
 * the design's warning table, not from `warningTextsFor` or the classifier.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RESIDUAL_RISK_LABEL, type AnalysisResult } from '../../src/shared/analysisContract';
import { validateSafety } from '../../src/lib/safety/safetyValidator';
import {
  BACKUP_BRANCH_LIMIT,
  BRANCH_REFLOG_LIMIT,
  BRANCH_TAG_BACKUP,
  CHECKOUT_FORCE,
  CLEAN_BIG_X,
  CLEAN_PERMANENT,
  CLEAN_X,
  GENERIC_DESTRUCTIVE_WARNING,
  LEASE_CONDITIONS,
  LEASE_LIMITS,
  PUSH_FORCE_LEASE_ADVICE,
  PUSH_FORCE_OVERWRITE,
  RESET_UNCOMMITTED,
  STASH_IGNORED,
  STASH_NOT_GUARANTEE,
  UNPROTECTED_DATA,
} from '../../src/lib/safety/warnings';
import { type ExpectedRisky, arbAnalysisResultWithMeta } from '../arbitraries';

/** Reference warning texts per the design's "Warning text constants" table. */
function referenceWarningTexts(risky: ExpectedRisky): string[] {
  const stashTexts = [STASH_NOT_GUARANTEE, STASH_IGNORED, UNPROTECTED_DATA];
  switch (risky.operation) {
    case 'reset_hard':
      return [RESET_UNCOMMITTED, BACKUP_BRANCH_LIMIT, ...stashTexts];
    case 'checkout_force':
      return [CHECKOUT_FORCE, ...stashTexts];
    case 'clean_force':
      return [CLEAN_PERMANENT, ...(risky.clean!.x ? [CLEAN_X] : []), ...(risky.clean!.X ? [CLEAN_BIG_X] : [])];
    case 'push_force':
      return [PUSH_FORCE_OVERWRITE, PUSH_FORCE_LEASE_ADVICE];
    case 'push_force_with_lease': {
      const { remote, branch } = risky.push!;
      const conditions = LEASE_CONDITIONS.split('<remote>').join(remote).split('<branch>').join(branch);
      return [LEASE_LIMITS, conditions];
    }
    case 'branch_force_delete':
      return [BRANCH_REFLOG_LIMIT, ...risky.branchNames!.map((b) => BRANCH_TAG_BACKUP.split('<branch>').join(b))];
  }
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const MARKER = ' #orig-';

describe('Property 14: Warnings are preserved and complete', () => {
  it('keeps input warnings as a prefix, adds every specific text, and the residual label exactly once', () => {
    fc.assert(
      fc.property(arbAnalysisResultWithMeta({ warnings: { allowLabel: true } }), ({ result, blocks }) => {
        // Expected Risky_Commands per original step, in step order.
        const expectedPerStep: ExpectedRisky[][] = blocks.flatMap((b) =>
          b.steps.map((_, i) => (b.risky && i === b.steps.length - 1 ? b.risky.expected : [])),
        );
        expect(expectedPerStep).toHaveLength(result.recoverySteps.length);

        // Tag original titles so they can be told apart from inserted Safeguard_Steps.
        const input: AnalysisResult = {
          ...result,
          recoverySteps: result.recoverySteps.map((s, i) => ({ ...s, title: `${s.title}${MARKER}${i}` })),
        };
        const output = validateSafety(input);
        const originals = output.recoverySteps.filter((s) => s.title.includes(MARKER));
        expect(originals).toHaveLength(input.recoverySteps.length);

        originals.forEach((out, i) => {
          const inStep = input.recoverySteps[i];
          expect(out.title).toBe(inStep.title);
          const expectedRisky = expectedPerStep[i];
          const inWarning = inStep.warningMessage;

          if (expectedRisky.length > 0) {
            const outWarning = out.warningMessage ?? '';
            if (inWarning) expect(outWarning.startsWith(inWarning)).toBe(true);
            for (const risky of expectedRisky) {
              for (const text of referenceWarningTexts(risky)) {
                expect(outWarning).toContain(text);
              }
            }
            expect(countOccurrences(outWarning, RESIDUAL_RISK_LABEL)).toBe(1);
          } else if (inWarning) {
            expect(out.warningMessage).toBe(inWarning);
          } else if (inStep.riskLevel === 'destructive') {
            expect(out.warningMessage).toBe(GENERIC_DESTRUCTIVE_WARNING);
          } else {
            expect(out.warningMessage).toBeUndefined();
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});
