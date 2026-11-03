#!/usr/bin/env node
/**
 * Post-build secret scan (Req 24.6).
 *
 * Scans every file under a build output directory (default `dist/`) for AWS
 * access key IDs matching `AKIA[0-9A-Z]{16}`. Exits with code 1 when any match
 * is found, so `npm run build` (which runs this as `postbuild`) fails.
 *
 * Matched key values are reported only in redacted form so the scan itself
 * never prints a secret to CI logs.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AWS_ACCESS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/g;

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) files.push(...listFiles(full));
    else if (info.isFile()) files.push(full);
  }
  return files;
}

function redact(key) {
  return `${key.slice(0, 4)}${'*'.repeat(key.length - 4)}`;
}

/**
 * Scan `dir` recursively and return one entry per match:
 * `{ file, line, redacted }`, where `file` is relative to `dir`.
 * Throws if `dir` does not exist.
 */
export function scanForSecrets(dir) {
  const root = resolve(dir);
  if (!existsSync(root)) {
    throw new Error(`Directory not found: ${root}`);
  }
  const matches = [];
  for (const file of listFiles(root)) {
    // latin1 keeps a 1:1 byte mapping, so binary files cannot hide ASCII keys.
    const content = readFileSync(file).toString('latin1');
    const lines = content.split('\n');
    lines.forEach((text, index) => {
      for (const m of text.matchAll(AWS_ACCESS_KEY_PATTERN)) {
        matches.push({ file: relative(root, file), line: index + 1, redacted: redact(m[0]) });
      }
    });
  }
  return matches;
}

/** CLI entry: returns the process exit code (0 clean, 1 matches, 2 error). */
export function main(dir = 'dist') {
  let matches;
  try {
    matches = scanForSecrets(dir);
  } catch (error) {
    console.error(`check-dist-secrets: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (matches.length > 0) {
    console.error(`check-dist-secrets: found ${matches.length} possible AWS access key(s) in ${dir}:`);
    for (const m of matches) console.error(`  ${m.file}:${m.line} ${m.redacted}`);
    return 1;
  }
  console.log(`check-dist-secrets: no AWS access keys found in ${dir}.`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main(process.argv[2] ?? 'dist');
}
