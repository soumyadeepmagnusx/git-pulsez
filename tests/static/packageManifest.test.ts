/// <reference types="node" />
/**
 * Static checks over the frontend `package.json` (Req 23.3, 24.10, 24.6).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './sourceScan';

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;

/** Exact package names that are not allowed in the frontend manifest. */
const DENIED_NAMES = new Set([
  'aws-sdk', 'pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'sqlite3', 'better-sqlite3',
  'prisma', '@prisma/client', 'firebase', 'next-auth', 'passport', 'jsonwebtoken',
  'amazon-cognito-identity-js', 'aws-amplify',
]);
/** Scope prefixes that are not allowed in the frontend manifest. */
const DENIED_PREFIXES = ['@aws-sdk/', '@supabase/', '@auth0/'];

function isDenied(name: string): boolean {
  return DENIED_NAMES.has(name) || DENIED_PREFIXES.some((p) => name.startsWith(p));
}

describe('static: frontend package.json', () => {
  const allDeps = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });

  it('lists no AWS SDK, database, or auth packages (Req 23.3, 24.10)', () => {
    expect(allDeps.length).toBeGreaterThan(0);
    expect(allDeps.filter(isDenied)).toEqual([]);
  });

  it('denylist matcher recognizes denied names and scopes', () => {
    expect(isDenied('@aws-sdk/client-bedrock-runtime')).toBe(true);
    expect(isDenied('@supabase/supabase-js')).toBe(true);
    expect(isDenied('pg')).toBe(true);
    expect(isDenied('react')).toBe(false);
    expect(isDenied('pg-like-name')).toBe(false);
  });

  it('runs the dist secret scan as the postbuild script (Req 24.6)', () => {
    expect(manifest.scripts?.build).toBeDefined();
    expect(manifest.scripts?.postbuild).toBe('node scripts/check-dist-secrets.mjs');
  });
});
