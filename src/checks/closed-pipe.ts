import { crashEvidence, ERROR_RE } from '../core/evidence.ts';
import {
    LONG_RUN_WINDOW_MS,
    markLongRunning,
    probeTimeout,
    stillRunning,
} from '../core/long-running.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Context, Judgement, Result } from '../core/types.ts';

export interface ClosedPipeResult extends Result {
    baseline: { exitCode: number | null; signal: NodeJS.Signals | null; stdoutBytes: number };
    closed: {
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        timedOut: boolean;
        stderr: string;
    };
}

/** A program that writes an error to stderr only once its stdout is closed. */
const newWriteError = (base: RunResult, closed: RunResult): boolean =>
    ERROR_RE.test(closed.stderr) && !ERROR_RE.test(base.stderr);

/**
 * For a program that keeps running (a server, a watcher): there is no normal exit
 * to compare with, but a crash once stdout is closed is still a crash.
 */
export function judgeLongRunning(base: RunResult, closed: RunResult): Judgement {
    // Warn-only until calibrated against real servers and watchers (product rule: no false fails).
    if (!closed.timedOut && newWriteError(base, closed)) {
        return {
            verdict: 'warn',
            reason: `crashed when stdout was closed, while a normal run kept running (exit ${closed.exitCode})`,
            evidence: crashEvidence(closed.stderr),
        };
    }
    if (closed.signal === 'SIGPIPE') {
        return { verdict: 'pass', reason: 'stopped by SIGPIPE, the conventional exit' };
    }
    if (base.stdoutBytes === 0) {
        return {
            verdict: 'skip',
            reason: `${stillRunning(base.durationMs)} without writing to stdout, so a closed stdout was never touched`,
        };
    }
    if (!closed.timedOut) {
        return { verdict: 'pass', reason: 'exited quietly when stdout was closed' };
    }
    if (newWriteError(base, closed)) {
        return {
            verdict: 'warn',
            reason: 'printed a write error when stdout was closed, and kept running',
            evidence: crashEvidence(closed.stderr),
        };
    }
    return {
        verdict: 'pass',
        reason: `${stillRunning(base.durationMs)}; with stdout closed it kept running without a write error`,
    };
}

/** Compares a normal run with a closed-stdout run of the same invocation. */
export function judge(base: RunResult, closed: RunResult): Judgement {
    if (base.spawnError) return { verdict: 'error', reason: `could not start: ${base.spawnError}` };
    if (base.timedOut) return judgeLongRunning(base, closed);
    if (base.stdoutBytes === 0) {
        return {
            verdict: 'skip',
            reason: 'wrote nothing to stdout, so a closed stdout is never touched',
        };
    }
    if (closed.timedOut) return { verdict: 'fail', reason: 'hung after stdout was closed' };
    if (closed.signal === 'SIGPIPE') {
        return { verdict: 'pass', reason: 'stopped by SIGPIPE, the conventional exit' };
    }
    const newError = newWriteError(base, closed);
    if (newError && closed.exitCode !== base.exitCode) {
        return {
            verdict: 'fail',
            reason: `crashed when stdout was closed (exit ${base.exitCode} -> ${closed.exitCode})`,
            evidence: crashEvidence(closed.stderr),
        };
    }
    if (newError) {
        return {
            verdict: 'warn',
            reason: 'printed a write error but kept its exit code',
            evidence: crashEvidence(closed.stderr),
        };
    }
    if (closed.exitCode !== base.exitCode) {
        return { verdict: 'pass', reason: `exited quietly with code ${closed.exitCode}` };
    }
    return { verdict: 'pass', reason: 'exited quietly' };
}

export async function closedPipe(
    command: string,
    args: readonly string[],
    ctx: Context
): Promise<ClosedPipeResult> {
    const base = await run(command, args, {
        closedStdout: false,
        timeout: probeTimeout(ctx, command, args),
    });
    if (base.timedOut) markLongRunning(ctx, command, args);
    // A program that crashes on a closed stdout does so at its first write.
    const closed = await run(command, args, {
        closedStdout: true,
        timeout: base.timedOut ? Math.min(ctx.timeout, LONG_RUN_WINDOW_MS) : ctx.timeout,
    });
    return {
        check: 'closed-pipe',
        invocation: [command, ...args],
        ...judge(base, closed),
        baseline: { exitCode: base.exitCode, signal: base.signal, stdoutBytes: base.stdoutBytes },
        closed: {
            exitCode: closed.exitCode,
            signal: closed.signal,
            timedOut: closed.timedOut,
            stderr: closed.stderr.slice(-2000),
        },
    };
}

export const closedPipeCheck: Check = {
    name: 'closed-pipe',
    kind: 'check',
    summary: 'crashes or hangs when stdout is closed early (| head, grep -q, an agent)',
    async run(target, ctx) {
        const results: Result[] = [];
        for (const args of target.invocations) {
            results.push(await closedPipe(target.command, args, ctx));
        }
        return results;
    },
};
