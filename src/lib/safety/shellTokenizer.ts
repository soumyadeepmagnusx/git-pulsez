/**
 * Shell tokenizer for Recovery_Step commands.
 *
 * Splits a command string into segments on unquoted control operators
 * (`&&`, `||`, `;`, `|`, `&`, newlines) and splits each segment into shell
 * words, honoring single quotes, double quotes, and backslash escapes.
 *
 * The tokenizer never executes anything; it only produces words for the Git
 * command parser. Its behavior is conservative so classification never
 * lowers risk:
 * - An unclosed quote consumes the rest of the command (separators included)
 *   into the current word.
 * - A lone `&` is treated as a separator, so `git reset --hard&` still yields
 *   the word `--hard`.
 * - `#` is not treated as a comment, so no text is hidden from classification.
 *
 * Requirements: 11.1, 11.2
 */

/** Control operators that end a segment when they appear unquoted. */
export const SEGMENT_SEPARATORS = ['&&', '||', ';', '|', '&', '\n'] as const;

type QuoteState = 'none' | 'single' | 'double';

/** Characters that a backslash escapes inside double quotes (POSIX). */
const DOUBLE_QUOTE_ESCAPABLE = new Set(['"', '\\', '$', '`']);

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v';
}

/**
 * Tokenizes a command into segments of shell words.
 *
 * @example
 * tokenizeCommand(`git reset --hard && git clean -fdx`)
 * // [['git', 'reset', '--hard'], ['git', 'clean', '-fdx']]
 * tokenizeCommand(`git commit -m "fix; --force"`)
 * // [['git', 'commit', '-m', 'fix; --force']]
 *
 * Empty segments (for example from `;;` or a trailing `&&`) are omitted.
 */
export function tokenizeCommand(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let current = '';
  // True once the current word has started, so that `''` yields an empty word.
  let inWord = false;
  let quote: QuoteState = 'none';

  const endWord = (): void => {
    if (inWord) {
      words.push(current);
      current = '';
      inWord = false;
    }
  };

  const endSegment = (): void => {
    endWord();
    if (words.length > 0) {
      segments.push(words);
    }
    words = [];
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i];

    if (quote === 'single') {
      if (ch === "'") {
        quote = 'none';
      } else {
        current += ch;
      }
      i += 1;
      continue;
    }

    if (quote === 'double') {
      if (ch === '"') {
        quote = 'none';
        i += 1;
      } else if (ch === '\\' && i + 1 < command.length) {
        const next = command[i + 1];
        if (next === '\n') {
          // Line continuation inside double quotes: drop both characters.
        } else if (DOUBLE_QUOTE_ESCAPABLE.has(next)) {
          current += next;
        } else {
          current += ch + next;
        }
        i += 2;
      } else {
        current += ch;
        i += 1;
      }
      continue;
    }

    // Unquoted context.
    if (ch === '\\') {
      if (i + 1 < command.length) {
        const next = command[i + 1];
        if (next !== '\n') {
          // Backslash-newline is a line continuation; anything else is literal.
          current += next;
          inWord = true;
        }
        i += 2;
      } else {
        // Trailing backslash: keep it literally.
        current += ch;
        inWord = true;
        i += 1;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch === "'" ? 'single' : 'double';
      inWord = true;
      i += 1;
      continue;
    }

    if (ch === '\n' || ch === ';') {
      endSegment();
      i += 1;
      continue;
    }

    if (ch === '&' || ch === '|') {
      // `&&`, `||`, `|&` are two-character operators; `&` and `|` are single.
      const next = command[i + 1];
      const twoChar = next === ch || (ch === '|' && next === '&');
      endSegment();
      i += twoChar ? 2 : 1;
      continue;
    }

    if (isWhitespace(ch)) {
      endWord();
      i += 1;
      continue;
    }

    current += ch;
    inWord = true;
    i += 1;
  }

  // An unclosed quote leaves the remainder in `current` as one word.
  endSegment();
  return segments;
}

/**
 * Returns the words of every segment flattened into one list. Useful for
 * callers that only need to scan for tokens regardless of segment boundaries.
 */
export function tokenizeWords(command: string): string[] {
  return tokenizeCommand(command).flat();
}
