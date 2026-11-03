/// <reference types="node" />
/**
 * Static checks over the deployment guide `docs/DEPLOYMENT.md` (Req 24.9).
 *
 * The guide must document the static frontend deployment (Amplify, with
 * Vercel/Netlify notes), public URL verification, `VITE_BEDROCK_ENDPOINT_URL`,
 * the Bedrock_Handler API contract, and its environment variables.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAFETY_OVERCLAIM_PHRASES, containsOverclaim } from '../../src/shared/analysisContract';
import { REPO_ROOT } from './sourceScan';

const DOC_PATH = join(REPO_ROOT, 'docs', 'DEPLOYMENT.md');

function readDoc(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

/** Body of a `## ` section, from its heading up to the next `## ` heading. */
function section(doc: string, heading: string): string {
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * The API contract section legitimately lists the Safety_Overclaim_Phrases,
 * each wrapped in double quotes, to explain which handler responses the
 * frontend rejects. Remove those quoted mentions so the overclaim check only
 * flags phrases used to describe safety.
 */
function stripQuotedOverclaimMentions(text: string): string {
  let out = text;
  for (const phrase of SAFETY_OVERCLAIM_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`"${escaped}"`, 'gi'), '');
  }
  return out;
}

const REQUIRED_HEADINGS = [
  '## Deploy the static frontend on AWS Amplify Hosting',
  '## Vercel and Netlify',
  '## Verify the public URL',
  '## Configure VITE_BEDROCK_ENDPOINT_URL',
  '## Bedrock_Handler API contract',
  '## Bedrock_Handler environment variables',
];

describe('static: docs/DEPLOYMENT.md (Req 24.9)', () => {
  it('exists', () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it('contains every required section heading', () => {
    const lines = readDoc().split(/\r?\n/).map((l) => l.trim());
    for (const heading of REQUIRED_HEADINGS) {
      expect(lines, heading).toContain(heading);
    }
  });

  it('documents the Amplify build command and output directory', () => {
    const amplify = section(readDoc(), '## Deploy the static frontend on AWS Amplify Hosting');
    expect(amplify).toContain('npm run build');
    expect(amplify).toMatch(/\bdist\b/);
  });

  it('documents VITE_BEDROCK_ENDPOINT_URL as an https: build-time value', () => {
    const cfg = section(readDoc(), '## Configure VITE_BEDROCK_ENDPOINT_URL');
    expect(cfg).toContain('VITE_BEDROCK_ENDPOINT_URL');
    expect(cfg).toContain('https:');
    expect(cfg.toLowerCase()).toContain('build-time');
  });

  it('documents the Bedrock_Handler API contract', () => {
    const api = section(readDoc(), '## Bedrock_Handler API contract');
    for (const term of ['POST', 'incidentText', '200', '400', '502', 'Access-Control-Allow-Origin']) {
      expect(api, term).toContain(term);
    }
  });

  it('documents the Bedrock_Handler environment variables', () => {
    const env = section(readDoc(), '## Bedrock_Handler environment variables');
    for (const name of ['BEDROCK_MODEL_ID', 'AWS_REGION', 'ALLOWED_ORIGIN']) {
      expect(env, name).toContain(name);
    }
  });

  it('contains no AWS access key ID', () => {
    expect(readDoc()).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('uses no Safety_Overclaim_Phrase to describe safety', () => {
    const doc = readDoc();
    // The quoted list exists in the raw doc, so the strip step is meaningful.
    expect(containsOverclaim(doc)).toBe(true);
    expect(containsOverclaim(stripQuotedOverclaimMentions(doc))).toBe(false);
  });
});
