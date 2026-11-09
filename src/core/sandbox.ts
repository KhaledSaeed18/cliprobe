import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Sandbox {
    /** A throwaway directory used as HOME and TMPDIR. The caller removes it. */
    dir: string;
    env: Record<string, string>;
}

/** A minimal environment: no tokens or config from the caller's shell. */
export function sandbox(): Sandbox {
    const dir = mkdtempSync(join(tmpdir(), 'cliprobe-'));
    const env = {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        LANG: process.env['LANG'] ?? 'C.UTF-8',
        HOME: dir,
        TMPDIR: dir,
        TERM: 'dumb',
        CI: '1',
        NO_UPDATE_NOTIFIER: '1',
    };
    return { dir, env };
}
