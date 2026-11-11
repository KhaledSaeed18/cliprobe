import { stripEscapes } from '../core/ansi.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Judgement, Result } from '../core/types.ts';

/** How long the program gets with stdin left open before it counts as waiting. */
export const STDIN_WAIT_MS = 3000;
/** When the confirming run closes stdin, and how long it then gets to finish. */
export const STDIN_CLOSE_AFTER_MS = 1000;
const STDIN_GRACE_MS = 3000;

/** The runs behind one verdict; later runs are left out once the verdict is settled. */
export interface StdinRuns {
    /** stdin is /dev/null, as cliprobe's other checks run it. */
    closed: RunResult;
    /** stdin is a pipe nobody writes to and that stays open. */
    open?: RunResult;
    /** stdin is a pipe closed after STDIN_CLOSE_AFTER_MS: proves stdin was the cause. */
    closing?: RunResult;
}

export interface StdinResult extends Result {
    closedMs: number | null;
    waitedForStdin: boolean;
    /** Milliseconds from closing stdin to the program finishing, when that was measured. */
    finishedAfterCloseMs: number | null;
}

/** The last line printed before waiting, when it reads like a question left on the line. */
function promptLine(r: RunResult): string | undefined {
    const text = stripEscapes(r.stdout.toString('utf8') + r.stderr);
    const last = text.split('\n').at(-1) ?? '';
    // A spinner also leaves a line unfinished, but redraws it with carriage returns.
    if (last.includes('\r') || last.trim() === '') return undefined;
    return last;
}

/**
 * `defaultProbe` is true for cliprobe's own `--version` and `--help` probes, which
 * must never wait for input. For probes the user wrote, waiting can be the point
 * (a filter such as `grep pattern`), so only a prompt-like wait warns.
 */
export function judgeStdin(runs: StdinRuns, defaultProbe: boolean): Judgement {
    const { closed, open, closing } = runs;
    if (closed.spawnError) {
        return { verdict: 'error', reason: `could not start: ${closed.spawnError}` };
    }
    if (closed.timedOut) {
        return {
            verdict: 'skip',
            reason: "doesn't finish even with stdin closed, so stdin isn't what it waits for",
        };
    }
    if (!open || !open.timedOut) {
        return { verdict: 'pass', reason: 'finished without waiting for stdin' };
    }
    if (!closing || closing.timedOut) {
        return {
            verdict: 'skip',
            reason: "hung with stdin open, but closing stdin didn't end it, so the cause isn't proven",
        };
    }
    const evidence = `${closed.durationMs} ms with stdin closed; still running after ${STDIN_WAIT_MS / 1000} s with stdin open; finished ${closing.durationMs - STDIN_CLOSE_AFTER_MS} ms after stdin closed`;
    if (defaultProbe) {
        return {
            verdict: 'fail',
            reason: 'waited for stdin before answering, so an agent or CI step that leaves stdin open hangs forever',
            evidence,
        };
    }
    const prompt = promptLine(open);
    if (prompt !== undefined) {
        return {
            verdict: 'warn',
            reason: "seems to prompt for input even though stdin isn't a terminal",
            evidence: `prompt: ${prompt.slice(0, 120)}; ${evidence}`,
        };
    }
    return {
        verdict: 'skip',
        reason: 'reads stdin like a filter and waits until it closes; give it input or </dev/null',
        evidence,
    };
}

async function stdinRuns(
    command: string,
    args: readonly string[],
    timeout: number
): Promise<StdinRuns> {
    const closed = await run(command, args, { timeout });
    if (closed.spawnError || closed.timedOut) return { closed };
    const open = await run(command, args, { timeout: STDIN_WAIT_MS, stdin: 'open' });
    if (!open.timedOut) return { closed, open };
    const closing = await run(command, args, {
        timeout: STDIN_CLOSE_AFTER_MS + STDIN_GRACE_MS,
        stdin: { closeAfterMs: STDIN_CLOSE_AFTER_MS },
    });
    return { closed, open, closing };
}

export async function stdinCheck(
    command: string,
    args: readonly string[],
    defaultProbe: boolean,
    timeout: number
): Promise<StdinResult> {
    const runs = await stdinRuns(command, args, timeout);
    const proven =
        runs.open?.timedOut === true && runs.closing !== undefined && !runs.closing.timedOut;
    return {
        check: 'stdin',
        invocation: [command, ...args],
        ...judgeStdin(runs, defaultProbe),
        closedMs: runs.closed.spawnError ? null : runs.closed.durationMs,
        waitedForStdin: proven,
        finishedAfterCloseMs:
            proven && runs.closing ? runs.closing.durationMs - STDIN_CLOSE_AFTER_MS : null,
    };
}

export const stdinCheckDefinition: Check = {
    name: 'stdin',
    kind: 'check',
    summary: 'waits for stdin when it is an open pipe, as agents and CI runners leave it',
    async run(target, ctx) {
        const results: Result[] = [];
        for (const args of target.invocations) {
            results.push(await stdinCheck(target.command, args, !target.explicit, ctx.timeout));
        }
        return results;
    },
};
