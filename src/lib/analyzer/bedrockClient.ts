/**
 * Bedrock_Handler HTTP client.
 *
 * This is the only frontend module that performs a network request (Req 18.9).
 * It never calls the global `fetch` directly; the caller injects `fetchFn`.
 * It sends only `{ incidentText }` with no cookies or credentials (Req 18.8, 24.6).
 *
 * Error model: `postIncident` never throws. It resolves to a discriminated
 * union so the Analyzer can map each failure to a `fallbackReason`:
 *   - `ok`           → candidate body, still to be checked by `acceptBedrockResult`
 *   - `error`        → network failure or non-2xx status   → `bedrock_error`
 *   - `timeout`      → no complete response within timeoutMs → `bedrock_timeout`
 *   - `invalid_json` → 2xx response whose body is not JSON  → `bedrock_invalid`
 */

export interface BedrockClientOptions {
  endpointUrl: string;
  fetchFn: typeof fetch;
  /** Abort after this many milliseconds (15,000 in production, Req 19.3). */
  timeoutMs: number;
}

export type BedrockClientResult =
  | { kind: 'ok'; body: unknown }
  | { kind: 'error'; status?: number }
  | { kind: 'timeout' }
  | { kind: 'invalid_json' };

export async function postIncident(
  incidentText: string,
  { endpointUrl, fetchFn, timeoutMs }: BedrockClientOptions,
): Promise<BedrockClientResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchFn(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentText }),
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch {
      return timedOut ? { kind: 'timeout' } : { kind: 'error' };
    }

    if (!response.ok) {
      return { kind: 'error', status: response.status };
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch {
      // The timeout also covers reading the body.
      return timedOut ? { kind: 'timeout' } : { kind: 'error', status: response.status };
    }
    if (timedOut) return { kind: 'timeout' };

    try {
      return { kind: 'ok', body: JSON.parse(raw) as unknown };
    } catch {
      return { kind: 'invalid_json' };
    }
  } finally {
    clearTimeout(timer);
  }
}
