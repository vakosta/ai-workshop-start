import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Recording } from '../../src/core/replay.ts';

/** Where the answers for `owner/repo` are kept. */
export function recordingFile(repository: string): string {
  return fileURLToPath(new URL(`./${repository.replace('/', '-')}.json`, import.meta.url));
}

/** What GitHub answered for `owner/repo` when it was recorded. */
export function recorded(repository: string): Recording {
  return JSON.parse(readFileSync(recordingFile(repository), 'utf8')) as Recording;
}
