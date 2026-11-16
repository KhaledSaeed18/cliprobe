import { crashEvidence, TRACE_RE } from '../core/evidence.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Judgement, Result } from '../core/types.ts';

/** How long the program runs before SIGTERM. */
export const SIGTERM_DELAY_MS = 1000;
/** How long it gets to exit after SIGTERM. */
export const SIGTERM_GRACE_MS = 3000;
/** How long its children get to follow it once it has exited. */
export const SIGTERM_LEFTOVERS_MS = 1000;

/** Lines worth quoting from a trace printed on SIGTERM, best first. */
const TRACE_MESSAGES: readonly RegExp[] = [/^(\w*Error\b|\w*Exception\b|panic:)/, TRACE_RE];

export interface SigtermResult extends Result {
    /** Milliseconds after start that SIGTERM was sent; null if the program had already exited. */
    sentAfterMs: number | null;
    /** Milliseconds from SIGTERM to exit; null if it was not sent or the program ignored it. */
    exitedAfterMs: number | null;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    /** Command lines of the processes it left running after it exited. */
    leftRunning: string[];
    /** The end of what it printed to stderr after SIGTERM. */
    stderrAfter: string;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 'es'}`;

export function judgeSigterm(r: RunResult): Judgement {
    if (r.spawnError) return { verdict: 'error', reason: `could not start: ${r.spawnError}` };
    if (r.signalSentMs === undefined) {
        return {
            verdict: 'skip',
            reason: `finished in ${r.durationMs} ms, before SIGTERM at ${SIGTERM_DELAY_MS} ms; probe a command that keeps running`,
        };
    }
    if (r.timedOut) {
        return {
            verdict: 'warn',
            reason: `ignored SIGTERM: still running ${SIGTERM_GRACE_MS / 1000} s later, so docker stop or a process manager has to kill it`,
        };
    }
    const left = r.leftRunning ?? [];
    const [firstLeft] = left;
    if (firstLeft) {
        return {
            verdict: 'warn',
            reason: `exited on SIGTERM but left ${plural(left.length, 'process')} running, which keep ports and files busy`,
            evidence: `still running: ${firstLeft.command}${left.length > 1 ? ` (and ${left.length - 1} more)` : ''}`,
        };
    }
    const after = r.stderr.slice(r.stderrAtSignal ?? 0);
    if (TRACE_RE.test(after)) {
        return {
            verdict: 'warn',
            reason: 'printed a stack trace on SIGTERM',
            evidence: crashEvidence(after, TRACE_MESSAGES),
        };
    }
    const ms = `${r.durationMs - r.signalSentMs} ms`;
    const how = r.signal ? `stopped by ${r.signal}` : `exited with code ${r.exitCode}`;
    return { verdict: 'pass', reason: `${how} in ${ms} and left nothing running` };
}

export async function sigterm(command: string, args: readonly string[]): Promise<SigtermResult> {
    // SIGTERM goes to the program alone, as kill, docker stop and process managers send
    // it, not to its group as a terminal sends Ctrl-C: a program must stop its own
    // children. stdin stays open, as in ctrl-c, so servers that stop at its end keep running.
    const r = await run(command, args, {
        timeout: SIGTERM_DELAY_MS + SIGTERM_GRACE_MS,
        signal: { name: 'SIGTERM', afterMs: SIGTERM_DELAY_MS, to: 'process' },
        stdin: 'open',
        leftoversMs: SIGTERM_LEFTOVERS_MS,
    });
    const sent = r.signalSentMs;
    return {
        check: 'sigterm',
        invocation: [command, ...args],
        ...judgeSigterm(r),
        sentAfterMs: sent ?? null,
        exitedAfterMs: sent === undefined || r.timedOut ? null : r.durationMs - sent,
        exitCode: r.exitCode,
        signal: r.signal,
        leftRunning: (r.leftRunning ?? []).map((m) => m.command),
        stderrAfter: sent === undefined ? '' : r.stderr.slice(r.stderrAtSignal ?? 0).slice(-2000),
    };
}

export const sigtermCheck: Check = {
    name: 'sigterm',
    kind: 'check',
    summary: 'ignores SIGTERM, or exits on it and leaves its child processes running',
    async run(target) {
        if (!target.explicit) {
            // --version and --help finish at once; one line says so instead of two skips.
            const skip: SigtermResult = {
                check: 'sigterm',
                invocation: [target.command],
                verdict: 'skip',
                reason: 'needs probe args that keep it running, such as a watch or serve command, or --bare',
                sentAfterMs: null,
                exitedAfterMs: null,
                exitCode: null,
                signal: null,
                leftRunning: [],
                stderrAfter: '',
            };
            return [skip];
        }
        const results: Result[] = [];
        for (const args of target.invocations) results.push(await sigterm(target.command, args));
        return results;
    },
};
