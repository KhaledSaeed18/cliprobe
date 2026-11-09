import { crashEvidence, ERROR_RE } from '../core/evidence.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Judgement, Result } from '../core/types.ts';

export interface ClosedPipeResult extends Result {
    baseline: { exitCode: number | null; signal: NodeJS.Signals | null; stdoutBytes: number };
    closed: {
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        timedOut: boolean;
        stderr: string;
    };
}

/** Compares a normal run with a closed-stdout run of the same invocation. */
export function judge(base: RunResult, closed: RunResult): Judgement {
    if (base.spawnError) return { verdict: 'error', reason: `could not start: ${base.spawnError}` };
    if (base.timedOut) return { verdict: 'error', reason: 'timed out on a normal run' };
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
    const newError = ERROR_RE.test(closed.stderr) && !ERROR_RE.test(base.stderr);
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
    timeout: number
): Promise<ClosedPipeResult> {
    const base = await run(command, args, { closedStdout: false, timeout });
    const closed = await run(command, args, { closedStdout: true, timeout });
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
            results.push(await closedPipe(target.command, args, ctx.timeout));
        }
        return results;
    },
};
