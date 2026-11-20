import { stripEscapes } from '../core/ansi.ts';
import { isLongRunning, markLongRunning } from '../core/long-running.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Context, Judgement, Result } from '../core/types.ts';

/** The least time the program gets with stdin left open before it counts as waiting. */
export const STDIN_WAIT_MS = 3000;
/** The earliest the confirming run closes stdin, and the least time it then gets to finish. */
export const STDIN_CLOSE_AFTER_MS = 1000;
const STDIN_GRACE_MS = 3000;

/**
 * How long a run must go past the one with stdin closed before stdin can be
 * blamed: twice that time and a second more, so a program that is merely slow
 * (3 to 4 s to answer) finishes well within it.
 */
export const stdinMargin = (closedMs: number): number => 2 * closedMs + 1000;

/** The runs behind one verdict; later runs are left out once the verdict is settled. */
export interface StdinRuns {
    /** stdin is /dev/null, as cliprobe's other checks run it. */
    closed: RunResult;
    /** stdin is a pipe nobody writes to and that stays open. */
    open?: RunResult;
    /** How long the open run was allowed: STDIN_WAIT_MS, or longer for a slow program. */
    openMs?: number;
    /** stdin is a pipe closed after `closeAfterMs`: proves stdin was the cause. */
    closing?: RunResult;
    /** When the confirming run closed stdin: STDIN_CLOSE_AFTER_MS, or later for a slow program. */
    closeAfterMs?: number;
}

/**
 * Whether the runs prove the program waited for stdin: it hung with stdin open
 * for well past the time it needed with stdin closed, and in the confirming run
 * it finished after stdin was closed, not before.
 */
export function provenByClose(runs: StdinRuns): boolean {
    const { closed, open, closing } = runs;
    const openMs = runs.openMs ?? STDIN_WAIT_MS;
    const closeAfterMs = runs.closeAfterMs ?? STDIN_CLOSE_AFTER_MS;
    return (
        open?.timedOut === true &&
        openMs >= stdinMargin(closed.durationMs) &&
        closing !== undefined &&
        !closing.timedOut &&
        closing.durationMs >= closeAfterMs
    );
}

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10} s`;

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
    const openMs = runs.openMs ?? STDIN_WAIT_MS;
    const closeAfterMs = runs.closeAfterMs ?? STDIN_CLOSE_AFTER_MS;
    if (openMs < stdinMargin(closed.durationMs)) {
        return {
            verdict: 'skip',
            reason: `takes ${closed.durationMs} ms even with stdin closed, too close to --timeout to tell whether an open stdin makes it wait; raise --timeout`,
        };
    }
    if (!closing || closing.timedOut) {
        return {
            verdict: 'skip',
            reason: "hung with stdin open, but closing stdin didn't end it, so the cause isn't proven",
        };
    }
    if (!provenByClose(runs)) {
        return {
            verdict: 'skip',
            reason: "hung once with stdin open, but finished before stdin was closed the next time, so the cause isn't proven",
        };
    }
    const evidence = `${closed.durationMs} ms with stdin closed; still running after ${seconds(openMs)} with stdin open; finished ${closing.durationMs - closeAfterMs} ms after stdin closed`;
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
    if (closed.timedOut) return { closed };
    if (closed.spawnError) return { closed };
    // A slow program gets as long as it needs, with room to spare, before an open
    // stdin is blamed; the probe timeout still bounds each run.
    const margin = stdinMargin(closed.durationMs);
    const openMs = Math.min(timeout, Math.max(STDIN_WAIT_MS, margin));
    const open = await run(command, args, { timeout: openMs, stdin: 'open' });
    if (!open.timedOut || openMs < margin) return { closed, open, openMs };
    // Closed only after the time it needs anyway, so finishing after the close shows
    // the close was what it waited for, not the end of its own work.
    const closeAfterMs = Math.max(STDIN_CLOSE_AFTER_MS, margin);
    const closing = await run(command, args, {
        timeout: closeAfterMs + Math.max(STDIN_GRACE_MS, margin),
        stdin: { closeAfterMs },
    });
    return { closed, open, openMs, closing, closeAfterMs };
}

export async function stdinCheck(
    command: string,
    args: readonly string[],
    defaultProbe: boolean,
    ctx: Context
): Promise<StdinResult> {
    // Another check already saw it keep running with stdin closed: nothing to learn here.
    if (isLongRunning(ctx, command, args)) {
        return {
            check: 'stdin',
            invocation: [command, ...args],
            verdict: 'skip',
            reason: "keeps running even with stdin closed, so stdin isn't what it waits for",
            closedMs: null,
            waitedForStdin: false,
            finishedAfterCloseMs: null,
        };
    }
    const runs = await stdinRuns(command, args, ctx.timeout);
    if (runs.closed.timedOut) markLongRunning(ctx, command, args);
    const proven = provenByClose(runs);
    return {
        check: 'stdin',
        invocation: [command, ...args],
        ...judgeStdin(runs, defaultProbe),
        closedMs: runs.closed.spawnError ? null : runs.closed.durationMs,
        waitedForStdin: proven,
        finishedAfterCloseMs:
            proven && runs.closing
                ? runs.closing.durationMs - (runs.closeAfterMs ?? STDIN_CLOSE_AFTER_MS)
                : null,
    };
}

export const stdinCheckDefinition: Check = {
    name: 'stdin',
    kind: 'check',
    summary: 'waits for stdin when it is an open pipe, as agents and CI runners leave it',
    async run(target, ctx) {
        const results: Result[] = [];
        for (const { args, own } of target.probes) {
            results.push(await stdinCheck(target.command, args, !own, ctx));
        }
        return results;
    },
};
