import { run } from '../core/run.ts';
import type { Check, Result } from '../core/types.ts';

/** Timed runs after one warm-up run, which fills the file system cache. */
export const STARTUP_RUNS = 5;

export interface StartupResult extends Result {
    /** Wall time of each timed run, in milliseconds. */
    runsMs: number[];
    medianMs: number | null;
}

export function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? (sorted[mid] ?? 0)
        : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

/**
 * Median wall time of one invocation: `<command> --version` by default, how long a
 * user waits for the simplest answer; or the probe exactly as given, so that
 * `node ./dist/cli.js --version` times the CLI rather than Node.
 */
export async function startup(
    command: string,
    args: readonly string[],
    timeout: number
): Promise<StartupResult> {
    const base = { check: 'startup', invocation: [command, ...args] };
    const warmUp = await run(command, args, { timeout });
    if (warmUp.spawnError) {
        return {
            ...base,
            verdict: 'error',
            reason: `could not start: ${warmUp.spawnError}`,
            runsMs: [],
            medianMs: null,
        };
    }
    if (warmUp.timedOut) {
        return { ...base, verdict: 'error', reason: 'timed out', runsMs: [], medianMs: null };
    }
    if (warmUp.exitCode !== 0) {
        return {
            ...base,
            verdict: 'skip',
            reason: `exited ${warmUp.exitCode ?? warmUp.signal}, so its time is not a fair startup measure`,
            runsMs: [],
            medianMs: null,
        };
    }
    const runsMs: number[] = [];
    for (let i = 0; i < STARTUP_RUNS; i++) {
        const r = await run(command, args, { timeout });
        if (r.timedOut || r.spawnError) {
            return {
                ...base,
                verdict: 'error',
                reason: 'a timed run did not finish',
                runsMs,
                medianMs: null,
            };
        }
        runsMs.push(r.durationMs);
    }
    const mid = median(runsMs);
    return {
        ...base,
        verdict: 'info',
        reason: `median ${mid} ms over ${STARTUP_RUNS} runs (min ${Math.min(...runsMs)}, max ${Math.max(...runsMs)})`,
        runsMs,
        medianMs: mid,
    };
}

export const startupCheck: Check = {
    name: 'startup',
    kind: 'info',
    summary: 'median wall time of --version, or of the given probe, over 5 runs',
    async run(target, ctx) {
        const args = target.explicit ? (target.invocations[0] ?? []) : ['--version'];
        return [await startup(target.command, args, ctx.timeout)];
    },
};
