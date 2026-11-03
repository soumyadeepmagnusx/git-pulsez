/**
 * Incident_Text validation (Req 1.3–1.6). Runs before the Analyzer is called.
 * Length is measured in UTF-16 code units (`String.length`), matching the
 * character counter shown in the Dashboard.
 */

import { MAX_INCIDENT_CHARS } from '../../shared/analysisContract';

export const EMPTY_INCIDENT_MESSAGE = 'Incident text is required.';
export const TOO_LONG_INCIDENT_MESSAGE = 'Incident text must be 20,000 characters or fewer.';

export type InputValidation =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_long'; message: string };

export function validateIncidentText(text: string): InputValidation {
  if (text.trim().length === 0) {
    return { ok: false, reason: 'empty', message: EMPTY_INCIDENT_MESSAGE };
  }
  if (text.length > MAX_INCIDENT_CHARS) {
    return { ok: false, reason: 'too_long', message: TOO_LONG_INCIDENT_MESSAGE };
  }
  return { ok: true };
}
