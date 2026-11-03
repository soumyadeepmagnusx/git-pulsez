/**
 * Frontend configuration.
 *
 * The only configurable value is the optional Bedrock_Endpoint_URL, read at
 * build time from `VITE_BEDROCK_ENDPOINT_URL`. It is accepted only when it
 * parses as an absolute `https:` URL; anything else (missing, empty, relative,
 * `http:`, other schemes) is treated as "not configured", so the Analyzer uses
 * the Fallback_Engine (Req 19.2).
 *
 * This file holds no credentials (Req 24.6).
 */

/** Returns the normalized endpoint URL if `raw` is a valid `https:` URL, otherwise `undefined`. */
export function parseEndpointUrl(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.hostname.length === 0) return undefined;
  // Reject embedded user info so no credentials can be carried in the URL.
  if (url.username !== '' || url.password !== '') return undefined;
  return url.toString();
}

/** The configured Bedrock_Endpoint_URL, or `undefined` when not configured. */
export function getBedrockEndpointUrl(): string | undefined {
  return parseEndpointUrl(import.meta.env.VITE_BEDROCK_ENDPOINT_URL);
}

/** Bedrock_Handler response timeout in milliseconds (Req 19.3). */
export const BEDROCK_TIMEOUT_MS = 15_000;

export interface AppConfig {
  readonly bedrockEndpointUrl: string | undefined;
  readonly bedrockTimeoutMs: number;
}

export const config: AppConfig = {
  bedrockEndpointUrl: getBedrockEndpointUrl(),
  bedrockTimeoutMs: BEDROCK_TIMEOUT_MS,
};
