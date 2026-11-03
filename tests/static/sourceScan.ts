/// <reference types="node" />
/**
 * Helpers for static checks over `src/`. Node-only; used by tests/static/*.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pass the string (not a URL object): under jsdom the global URL is jsdom's class.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC_DIR = join(REPO_ROOT, 'src');

export interface SourceFile {
  /** Path relative to the repo root, always with `/` separators. */
  path: string;
  /** Raw file text. */
  text: string;
  /** Text with comments and string/template literal contents blanked out. */
  code: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Blank out comments and the contents of string and template literals, keeping
 * the quote characters and newlines so line numbers stay stable. Template
 * literal `${...}` expressions are kept as code. This lets code-pattern checks
 * (such as `fetch(`) ignore prose like "git fetch origin" inside strings.
 */
export function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const templateDepth: number[] = []; // brace depth at which each open template resumes
  let braceDepth = 0;
  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ');

  const readTemplateBody = () => {
    // Called just after an opening backtick or after the `}` closing an expression.
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        out += '  ';
        i += 2;
      } else if (ch === '`') {
        out += '`';
        i += 1;
        return;
      } else if (ch === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        templateDepth.push(braceDepth);
        braceDepth += 1;
        return;
      } else {
        out += blank(ch);
        i += 1;
      }
    }
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i += 1) out += blank(src[i]);
    } else if (ch === '"' || ch === "'") {
      out += ch;
      i += 1;
      while (i < src.length && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
        } else {
          out += ' ';
          i += 1;
        }
      }
      if (i < src.length) {
        out += src[i];
        i += 1;
      }
    } else if (ch === '`') {
      out += '`';
      i += 1;
      readTemplateBody();
    } else if (ch === '{') {
      braceDepth += 1;
      out += ch;
      i += 1;
    } else if (ch === '}') {
      braceDepth -= 1;
      out += ch;
      i += 1;
      if (templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === braceDepth) {
        templateDepth.pop();
        readTemplateBody();
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

let cache: SourceFile[] | undefined;

/** All source files under `src/`, excluding co-located test files. */
export function loadSourceFiles(): SourceFile[] {
  if (cache) return cache;
  cache = walk(SRC_DIR)
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
    .map((full) => {
      const text = readFileSync(full, 'utf8');
      return {
        path: relative(REPO_ROOT, full).split(sep).join('/'),
        text,
        code: stripCommentsAndStrings(text),
      };
    });
  return cache;
}

/** Module specifiers from `import … from`, `export … from`, `import()`, and `require()`. */
export function moduleSpecifiers(text: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

/** 1-based line number of a character offset. */
export function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}
