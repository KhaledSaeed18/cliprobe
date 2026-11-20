import { crashEvidence, TRACE_RE } from '../core/evidence.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Judgement, Result } from '../core/types.ts';
import { describeLeftovers } from './sigterm.ts';

/** How long the program runs before Ctrl-C. */
export const CTRL_C_DELAY_MS = 1000;
/** How long it gets to exit after Ctrl-C. */
export const CTRL_C_GRACE_MS = 3000;
/** How long the rest of its group gets to follow it once it has exited. */
export const CTRL_C_LEFTOVERS_MS = 1000;

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
    /** Command lines of the processes it left running after it exited, in its group or started by it. */
    leftRunning: string[];
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
    // The Ctrl-C reached its whole group, as a terminal sends it, so what is still
    // running ignored it too. A new finding, so a warning (see the README's Stability).
    const left = r.leftRunning ?? [];
    if (left.length > 0) {
        const { count, evidence } = describeLeftovers(left);
        return {
            verdict: 'warn',
            reason: `exited on Ctrl-C in ${ms} but left ${count} running that ignored it`,
            evidence,
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
    // stdin is a pipe left open and never written, as a terminal leaves it: some servers
    // (esbuild --serve) stop at the end of stdin, and /dev/null would end them at once.
    const r = await run(command, args, {
        timeout: CTRL_C_DELAY_MS + CTRL_C_GRACE_MS,
        signal: { name: 'SIGINT', afterMs: CTRL_C_DELAY_MS },
        stdin: 'open',
        leftoversMs: CTRL_C_LEFTOVERS_MS,
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
        leftRunning: (r.leftRunning ?? []).map((m) => m.command),
        stderrAfter: sent === undefined ? '' : r.stderr.slice(r.stderrAtSignal ?? 0).slice(-2000),
    };
}

export const ctrlCCheck: Check = {
    name: 'ctrl-c',
    kind: 'check',
    summary: 'ignores Ctrl-C, or prints a stack trace when interrupted',
    async run(target) {
        const own = target.probes.filter((p) => p.own);
        if (own.length === 0) {
            // --version and --help finish at once; one line says so instead of two skips.
            const skip: CtrlCResult = {
                check: 'ctrl-c',
                invocation: [target.command],
                verdict: 'skip',
                reason: 'needs a probe that keeps running, such as a watch or serve command (--probe), or --bare',
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
        // The defaults finish at once, so only the probes the user named are worth a signal.
        for (const { args } of own) results.push(await ctrlC(target.command, args));
        return results;
    },
};
