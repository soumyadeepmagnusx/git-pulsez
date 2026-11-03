/**
 * Sanity checks for the shared fast-check arbitraries: they generate valid
 * values and their reference expectations agree with the implementation.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_INCIDENT_CHARS, isAnalysisResult, isHistoryEntry } from '../../src/shared/analysisContract';
import { classifyCommand } from '../../src/lib/safety/riskClassifier';
import { parseGitInvocations } from '../../src/lib/safety/gitCommandParser';
import { tokenizeCommand } from '../../src/lib/safety/shellTokenizer';
import { matchesPreserveChanges, safeguardSetFor, windowSatisfies } from '../../src/lib/safety/safeguards';
import { detectIncidentTypes, isTerminalOutput } from '../../src/lib/fallback/patterns';
import {
  arbAnalysisResult,
  arbAnalysisResultWithMeta,
  arbGitCommand,
  arbHistoryEntries,
  arbIncidentText,
  arbNoiseText,
  arbPlainLanguageText,
  arbStashCommand,
  referenceSafeguardCommands,
} from './index';

const RUNS = { numRuns: 50 };

describe('arbitraries sanity', () => {
  it('arbGitCommand words round-trip through the tokenizer', () => {
    fc.assert(
      fc.property(arbGitCommand(), (cmd) => {
        expect(tokenizeCommand(cmd.command)).toEqual(cmd.segments.map((s) => s.words));
      }),
      RUNS,
    );
  });

  it('arbGitCommand reference classification matches classifyCommand', () => {
    fc.assert(
      fc.property(arbGitCommand(), (cmd) => {
        const actual = classifyCommand(cmd.command).map((r) => ({
          operation: r.operation,
          level: r.level,
          ...(r.clean ? { clean: r.clean } : {}),
          ...(r.push ? { push: r.push } : {}),
          ...(r.branchNames ? { branchNames: r.branchNames } : {}),
        }));
        expect(actual).toEqual(cmd.expected);
      }),
      RUNS,
    );
  });

  it('reference safeguard commands match safeguardSetFor', () => {
    fc.assert(
      fc.property(arbGitCommand(), (cmd) => {
        const actual = classifyCommand(cmd.command).flatMap((r) => safeguardSetFor(r).map((s) => s.command));
        expect(actual).toEqual(cmd.expected.flatMap(referenceSafeguardCommands));
      }),
      RUNS,
    );
  });

  it('arbStashCommand expected result matches matchesPreserveChanges', () => {
    fc.assert(
      fc.property(arbStashCommand, (stash) => {
        const invs = parseGitInvocations(stash.command);
        expect(invs).toHaveLength(1);
        expect(matchesPreserveChanges(invs[0])).toBe(stash.accepted);
      }),
      { numRuns: 200 },
    );
  });

  it('arbIncidentText detects exactly the included types and stays within the limit', () => {
    fc.assert(
      fc.property(arbIncidentText(), (g) => {
        expect(g.text.length).toBeLessThanOrEqual(MAX_INCIDENT_CHARS);
        expect(g.text.trim().length).toBeGreaterThan(0);
        expect(detectIncidentTypes(g.text)).toEqual(g.includedTypes);
      }),
      RUNS,
    );
  });

  it('noise-only text matches no type and is not terminal output', () => {
    fc.assert(
      fc.property(arbNoiseText(), (text) => {
        expect(detectIncidentTypes(text)).toEqual([]);
        expect(isTerminalOutput(text)).toBe(false);
      }),
      RUNS,
    );
  });

  it('plain-language text has no terminal-output lines and detects the included types', () => {
    fc.assert(
      fc.property(arbPlainLanguageText(), (g) => {
        expect(isTerminalOutput(g.text)).toBe(false);
        expect(detectIncidentTypes(g.text)).toEqual(g.includedTypes);
      }),
      RUNS,
    );
  });

  it('arbAnalysisResult produces valid contract values in both modes', () => {
    fc.assert(
      fc.property(arbAnalysisResult(), (r) => {
        expect(isAnalysisResult(r)).toBe(true);
      }),
      RUNS,
    );
    for (const mode of ['bedrock_ai', 'fallback_demo'] as const) {
      fc.assert(
        fc.property(arbAnalysisResult({ mode }), (r) => {
          expect(r.analysisMode).toBe(mode);
          expect(isAnalysisResult(r)).toBe(true);
        }),
        { numRuns: 20 },
      );
    }
  });

  it('deliberately included window steps satisfy their safeguards', () => {
    fc.assert(
      fc.property(arbAnalysisResultWithMeta(), ({ blocks }) => {
        for (const block of blocks) {
          if (!block.risky) continue;
          const specs = classifyCommand(block.risky.command).flatMap(safeguardSetFor);
          const windowSteps = block.steps.slice(0, -1);
          for (const idx of block.includedSafeguards) {
            expect(windowSteps.some((s) => windowSatisfies(s.command, specs[idx]))).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it('arbHistoryEntries yields 0..10 valid entries with distinct createdAt', () => {
    fc.assert(
      fc.property(arbHistoryEntries(), (entries) => {
        expect(entries.length).toBeLessThanOrEqual(10);
        expect(new Set(entries.map((e) => e.createdAt)).size).toBe(entries.length);
        expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
        expect(entries.every(isHistoryEntry)).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});
