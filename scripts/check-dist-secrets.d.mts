export interface SecretMatch {
  file: string;
  line: number;
  redacted: string;
}
export const AWS_ACCESS_KEY_PATTERN: RegExp;
export function scanForSecrets(dir: string): SecretMatch[];
export function main(dir?: string): number;
