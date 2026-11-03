/// <reference types="node" />
/**
 * Static checks over `src/` (Req 18.5, 18.8, 23.1, 23.6, 23.7).
 *
 * Code-pattern checks run on source text with comments and string-literal
 * contents blanked out, so prose such as "git fetch origin" in a playbook or
 * warning string never counts as a call.
 *
 * Network policy (Req 18.8, 18.9):
 * - No module in `src/` calls the global `fetch(...)` directly.
 * - The injected `fetchFn(...)` is called only in `src/lib/analyzer/bedrockClient.ts`.
 * - The only reference to the global fetch is the allow-listed
 *   `globalThis.fetch.bind(globalThis)` in `src/lib/analyzer/analyzer.ts`
 *   (`defaultAnalyzerDeps`). It is a reference, not a call: it produces the
 *   `fetchFn` that `bedrockClient.ts` invokes, so `bedrockClient.ts` stays the
 *   only module that performs a request.
 * - No other network APIs (XMLHttpRequest, WebSocket, EventSource, sendBeacon).
 */
import { describe, expect, it } from 'vitest';
import { lineOf, loadSourceFiles, moduleSpecifiers, stripCommentsAndStrings } from './sourceScan';

const BEDROCK_CLIENT = 'src/lib/analyzer/bedrockClient.ts';
const ANALYZER = 'src/lib/analyzer/analyzer.ts';
const ALLOWED_GLOBAL_FETCH_REFERENCE = 'globalThis.fetch.bind(globalThis)';

const NODE_BUILTINS = new Set([
  'fs', 'fs/promises', 'child_process', 'path', 'os', 'net', 'http', 'https', 'crypto',
  'worker_threads', 'cluster', 'dgram', 'dns', 'tls', 'vm', 'process', 'module',
]);

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

function findAll(pattern: RegExp, field: 'code' | 'text', skip: (path: string) => boolean = () => false): Violation[] {
  const out: Violation[] = [];
  for (const f of loadSourceFiles()) {
    if (skip(f.path)) continue;
    const haystack = f[field];
    for (const m of haystack.matchAll(pattern)) {
      const line = lineOf(haystack, m.index ?? 0);
      out.push({ file: f.path, line, snippet: f.text.split('\n')[line - 1].trim() });
    }
  }
  return out;
}

describe('static: src/ file discovery', () => {
  it('finds the frontend source files, including the network modules', () => {
    const paths = loadSourceFiles().map((f) => f.path);
    expect(paths.length).toBeGreaterThan(10);
    expect(paths).toContain(BEDROCK_CLIENT);
    expect(paths).toContain(ANALYZER);
  });
});

describe('static: forbidden imports in src/ (Req 18.5, 23.7)', () => {
  it('imports nothing from backend/, @aws-sdk/, aws-sdk, or Node built-ins', () => {
    const violations: string[] = [];
    for (const f of loadSourceFiles()) {
      for (const spec of moduleSpecifiers(f.text)) {
        const bare = spec.replace(/^node:/, '');
        const forbidden =
          /(^|\/)backend(\/|$)/.test(spec) ||
          spec.startsWith('@aws-sdk/') ||
          spec === 'aws-sdk' ||
          spec.startsWith('node:') ||
          NODE_BUILTINS.has(bare) ||
          NODE_BUILTINS.has(bare.split('/')[0]);
        if (forbidden) violations.push(`${f.path}: ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never references child_process', () => {
    expect(findAll(/child_process/g, 'text')).toEqual([]);
  });

  it('never calls exec, spawn, eval, or the Function constructor', () => {
    const pattern = /(?<![.\w$])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork|eval)\s*\(|\bnew\s+Function\s*\(/g;
    expect(findAll(pattern, 'code')).toEqual([]);
  });
});

describe('static: network access in src/ (Req 18.8, 18.9)', () => {
  it('never calls the global fetch directly', () => {
    expect(findAll(/\bfetch\s*\(/g, 'code')).toEqual([]);
  });

  it('calls the injected fetchFn only in bedrockClient.ts', () => {
    expect(findAll(/\bfetchFn\s*\(/g, 'code', (p) => p === BEDROCK_CLIENT)).toEqual([]);
    expect(findAll(/\bfetchFn\s*\(/g, 'code', (p) => p !== BEDROCK_CLIENT).length).toBeGreaterThan(0);
  });

  it('references the global fetch only via the allow-listed bind in analyzer.ts', () => {
    const refs = findAll(/\b(?:globalThis|window|self|global)\s*(?:\.\s*fetch\b|\[\s*['"`]fetch)/g, 'text');
    const allowed = refs.filter((r) => r.file === ANALYZER && r.snippet.includes(ALLOWED_GLOBAL_FETCH_REFERENCE));
    expect(refs.filter((r) => !allowed.includes(r))).toEqual([]);
    expect(allowed).toHaveLength(1);
  });

  it('uses no other network APIs', () => {
    const pattern = /\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/g;
    expect(findAll(pattern, 'code')).toEqual([]);
  });
});

describe('static: build-time environment (Req 23.1, 23.6)', () => {
  const ALLOWED_ENV_KEYS = new Set(['VITE_BEDROCK_ENDPOINT_URL', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL']);

  it('never reads process.env', () => {
    expect(findAll(/\bprocess\s*\.\s*env\b/g, 'code')).toEqual([]);
  });

  it('reads only VITE_BEDROCK_ENDPOINT_URL and Vite built-ins from import.meta.env', () => {
    const violations: string[] = [];
    let endpointReads = 0;
    for (const f of loadSourceFiles()) {
      for (const m of f.code.matchAll(/\bimport\s*\.\s*meta\s*\.\s*env\b(\s*\.\s*(\w+))?/g)) {
        const key = m[2];
        if (key === 'VITE_BEDROCK_ENDPOINT_URL') endpointReads += 1;
        if (key === undefined || !ALLOWED_ENV_KEYS.has(key)) {
          violations.push(`${f.path}:${lineOf(f.code, m.index ?? 0)} ${key ?? '(dynamic access)'}`);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(endpointReads).toBeGreaterThanOrEqual(1);
  });

  it('mentions no AWS credential or region variables', () => {
    expect(findAll(/\bAWS_[A-Z_]+\b/g, 'code')).toEqual([]);
  });
});

describe('static: stripCommentsAndStrings', () => {
  it('blanks comments and string contents but keeps code and template expressions', () => {
    const src = [
      "const a = 'git fetch origin'; // fetch(x)",
      '/* fetch( */ const b = `x ${fetch(url)} y`;',
      'const c = "say \\"fetch(\\"";',
    ].join('\n');
    const code = stripCommentsAndStrings(src);
    expect(code.split('\n')).toHaveLength(3);
    const calls = [...code.matchAll(/\bfetch\s*\(/g)];
    expect(calls).toHaveLength(1);
    expect(lineOf(code, calls[0].index ?? 0)).toBe(2);
  });
});
