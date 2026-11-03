/**
 * Shared text and identifier arbitraries for property tests.
 *
 * - Identifiers (branches, remotes, paths, hashes) use a plain alphabet with
 *   no shell metacharacters and never start with `-`.
 * - `arbSafeText` draws from a vocabulary that contains no Incident trigger,
 *   no Safety_Overclaim_Phrase (no word contains `safe` or `protected`), and
 *   not the Residual_Risk_Label (no word `remains`).
 */

import fc from 'fast-check';
import { RESIDUAL_RISK_LABEL, SAFETY_OVERCLAIM_PHRASES } from '../../src/shared/analysisContract';

/** Lowercase words that cannot form a trigger, an overclaim phrase, or the residual label. */
export const SAFE_WORDS: readonly string[] = [
  'alpha', 'build', 'config', 'deploy', 'editor', 'folder', 'graph', 'index', 'job', 'kernel',
  'layout', 'module', 'notes', 'output', 'package', 'query', 'review', 'script', 'tests', 'update',
  'value', 'window', 'yaml', 'zone', 'check', 'prepare', 'cache', 'report', 'server', 'client',
  'local', 'team', 'shared', 'current', 'project', 'version', 'release', 'staging', 'pipeline', 'docs',
];

const lowerAlnum = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const lower = 'abcdefghijklmnopqrstuvwxyz'.split('');
const hexChars = '0123456789abcdef'.split('');

/** A single word starting with a lowercase letter: `[a-z][a-z0-9]{0,7}`. */
export const arbSimpleName: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...lower), fc.array(fc.constantFrom(...lowerAlnum), { maxLength: 7 }))
  .map(([head, tail]) => head + tail.join(''));

/** Branch name, optionally with one `prefix/` segment. Never starts with `-`. */
export const arbBranchName: fc.Arbitrary<string> = fc
  .tuple(fc.option(fc.constantFrom('feature', 'fix', 'release', 'user'), { nil: undefined }), arbSimpleName)
  .map(([prefix, name]) => (prefix ? `${prefix}/${name}` : name));

/** Remote name. */
export const arbRemoteName: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('origin', 'upstream', 'fork'),
  arbSimpleName,
);

/** Relative path such as `src/app.ts` or `build/`. */
export const arbPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(arbSimpleName, { minLength: 1, maxLength: 3 }),
    fc.constantFrom('', '/', '.ts', '.js', '.md', '.json'),
  )
  .map(([parts, suffix]) => parts.join('/') + suffix);

/** Abbreviated or full lowercase commit hash (7–40 hex characters). */
export const arbCommitHash: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...hexChars), { minLength: 7, maxLength: 40 })
  .map((chars) => chars.join(''));

/** Space-separated words from {@link SAFE_WORDS}. */
export function arbSafeText(opts: { minWords?: number; maxWords?: number } = {}): fc.Arbitrary<string> {
  const { minWords = 1, maxWords = 8 } = opts;
  return fc
    .array(fc.constantFrom(...SAFE_WORDS), { minLength: minWords, maxLength: maxWords })
    .map((words) => {
      const text = words.join(' ');
      return text.charAt(0).toUpperCase() + text.slice(1) + '.';
    });
}

/** Commit message that may contain option-like words and shell separators (must be quoted). */
export const arbCommitMessage: fc.Arbitrary<string> = fc.oneof(
  arbSafeText({ maxWords: 4 }),
  fc.constantFrom('wip', '--force', '-f', '--hard', '-D', 'fix; --force', 'a && git reset --hard', 'x | y', "it's done"),
);

export interface WarningTextOptions {
  /** Allow a Safety_Overclaim_Phrase somewhere in the text (Bedrock-like adversarial input). */
  allowOverclaim?: boolean;
  /** Allow the Residual_Risk_Label sentence at most once. */
  allowLabel?: boolean;
}

/**
 * Warning text. By default it contains no Safety_Overclaim_Phrase and no
 * Residual_Risk_Label. With `allowLabel` it may contain the label at most
 * once; with `allowOverclaim` it may contain one overclaim phrase (in any case).
 */
export function arbWarningText(opts: WarningTextOptions = {}): fc.Arbitrary<string> {
  const base = arbSafeText({ maxWords: 10 });
  const label = fc.boolean().map((b) => (b ? ` ${RESIDUAL_RISK_LABEL}.` : ''));
  const overclaim = fc
    .tuple(fc.constantFrom(...SAFETY_OVERCLAIM_PHRASES), fc.boolean())
    .map(([phrase, upper]) => ` This is ${upper ? phrase.toUpperCase() : phrase}.`);
  return fc
    .tuple(
      base,
      opts.allowLabel ? label : fc.constant(''),
      opts.allowOverclaim ? fc.oneof(fc.constant(''), overclaim) : fc.constant(''),
    )
    .map(([text, l, o]) => text + l + o);
}

// ---------------------------------------------------------------------------
// Shell quoting
// ---------------------------------------------------------------------------

const PLAIN_SHELL_WORD = /^[A-Za-z0-9_\-./:@+=,%^~<>{}]+$/;

/** True when the word can appear unquoted and the tokenizer reads it back unchanged. */
export function isPlainShellWord(word: string): boolean {
  return word !== '' && PLAIN_SHELL_WORD.test(word);
}

export type QuoteStyle = 'plain' | 'single' | 'double';

/** Renders one word so `tokenizeCommand` yields exactly `word`. Non-plain words are always quoted. */
export function renderShellWord(word: string, style: QuoteStyle): string {
  const effective: QuoteStyle = style === 'plain' && !isPlainShellWord(word) ? 'single' : style;
  switch (effective) {
    case 'plain':
      return word;
    case 'single':
      return `'${word.replace(/'/g, `'\\''`)}'`;
    case 'double':
      return `"${word.replace(/["\\$`]/g, (ch) => `\\${ch}`)}"`;
  }
}

/** Quote style weighted towards plain words. */
export const arbQuoteStyle: fc.Arbitrary<QuoteStyle> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<QuoteStyle>('plain') },
  { weight: 1, arbitrary: fc.constant<QuoteStyle>('single') },
  { weight: 1, arbitrary: fc.constant<QuoteStyle>('double') },
);

/** Renders a word list with random quoting (the first word, the executable, stays plain). */
export function arbRenderWords(words: readonly string[]): fc.Arbitrary<string> {
  return fc
    .array(arbQuoteStyle, { minLength: words.length, maxLength: words.length })
    .map((styles) => words.map((w, i) => (i === 0 ? renderShellWord(w, 'plain') : renderShellWord(w, styles[i]))).join(' '));
}
