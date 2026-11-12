import { crashEvidence, TRACE_RE } from '../core/evidence.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Judgement, Result } from '../core/types.ts';

/** How long the program runs before Ctrl-C. */
export const CTRL_C_DELAY_MS = 1000;
/** How long it gets to exit after Ctrl-C. */
export const CTRL_C_GRACE_MS = 3000;

/** Lines worth quoting from a trace printed on Ctrl-C, best first. */
const TRACE_MESSAGES: readonly RegExp[] = [
    /^(KeyboardInterrupt|\w*Error\b|\w*Exception\b|panic:)/,
    TRACE_RE,
];

export interface CtrlCResult extends Result {
    /** Milliseconds after start that SIGINT was sent; null if the program had already exited. */
    sentAfterMs: number | null;
    /** Milliseconds from SIGINT to exit; null if it was not sent. */
    exitedAfterMs: number | null;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    /** The end of what it printed to stderr after SIGINT. */
    stderrAfter: string;
}

export function judgeCtrlC(r: RunResult): Judgement {
    if (r.spawnError) return { verdict: 'error', reason: `could not start: ${r.spawnError}` };
    if (r.signalSentMs === undefined) {
        return {
            verdict: 'skip',
            reason: `finished in ${r.durationMs} ms, before Ctrl-C at ${CTRL_C_DELAY_MS} ms; probe a command that keeps running`,
        };
    }
    if (r.timedOut) {
        return {
            verdict: 'fail',
            reason: `ignored Ctrl-C: still running ${CTRL_C_GRACE_MS / 1000} s later`,
        };
    }
    const after = r.stderr.slice(r.stderrAtSignal ?? 0);
    const ms = `${r.durationMs - r.signalSentMs} ms`;
    if (TRACE_RE.test(after)) {
        return {
            verdict: 'fail',
            reason: 'printed a stack trace on Ctrl-C',
            evidence: crashEvidence(after, TRACE_MESSAGES),
        };
    }
    if (r.signal) return { verdict: 'pass', reason: `stopped by ${r.signal} in ${ms}` };
    if (r.exitCode === 130) {
        return { verdict: 'pass', reason: `exited with 130, the Ctrl-C convention, in ${ms}` };
    }
    if (r.exitCode === 0) {
        return {
            verdict: 'warn',
            reason: `exited 0 after Ctrl-C, so a script cannot tell it was interrupted (130 is the convention)`,
        };
    }
    return {
        verdict: 'pass',
        reason: `exited with code ${r.exitCode} in ${ms} (130 is the convention)`,
    };
}

export async function ctrlC(command: string, args: readonly string[]): Promise<CtrlCResult> {
    // No PTY: under script(1) the program would get SIGHUP, not SIGINT. A terminal sends
    // Ctrl-C to its foreground process group, and the program leads its own group here.
    const r = await run(command, args, {
        timeout: CTRL_C_DELAY_MS + CTRL_C_GRACE_MS,
        signal: { name: 'SIGINT', afterMs: CTRL_C_DELAY_MS },
    });
    const sent = r.signalSentMs;
    return {
        check: 'ctrl-c',
        invocation: [command, ...args],
        ...judgeCtrlC(r),
        sentAfterMs: sent ?? null,
        exitedAfterMs: sent === undefined || r.timedOut ? null : r.durationMs - sent,
        exitCode: r.exitCode,
        signal: r.signal,
        stderrAfter: sent === undefined ? '' : r.stderr.slice(r.stderrAtSignal ?? 0).slice(-2000),
    };
}

export const ctrlCCheck: Check = {
    name: 'ctrl-c',
    kind: 'check',
    summary: 'ignores Ctrl-C, or prints a stack trace when interrupted',
    async run(target) {
        if (!target.explicit) {
            // --version and --help finish at once; one line says so instead of two skips.
            const skip: CtrlCResult = {
                check: 'ctrl-c',
                invocation: [target.command],
                verdict: 'skip',
                reason: 'needs probe args that keep it running, such as a watch or serve command, or --bare',
                sentAfterMs: null,
                exitedAfterMs: null,
                exitCode: null,
                signal: null,
                stderrAfter: '',
            };
            return [skip];
        }
        const results: Result[] = [];
        for (const args of target.invocations) results.push(await ctrlC(target.command, args));
        return results;
    },
};
