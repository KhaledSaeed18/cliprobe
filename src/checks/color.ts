import { findStyle, type StyleHit } from '../core/ansi.ts';
import { ptySupport, runPty, type PtyResult } from '../core/pty.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Judgement, Result } from '../core/types.ts';

/**
 * Every color run gets a terminal type that supports color, so a program cannot
 * pass by seeing TERM=dumb, and no CI variable, which some color libraries treat
 * as a reason to force color on.
 */
const COLOR_ENV = { TERM: 'xterm-256color', CI: undefined } as const;

/** What the color runs saw. Runs after the verdict was settled are left out. */
export interface ColorRuns {
    pipe: RunResult;
    tty?: PtyResult;
    noColor?: PtyResult;
    /** Why there is no PTY run, when there could not be one. */
    noPty?: string;
}

export interface ColorResult extends Result {
    pipe: { exitCode: number | null; stdoutStyled: boolean; stderrStyled: boolean };
    tty: { exitCode: number | null; timedOut: boolean; styled: boolean } | null;
    noColor: { exitCode: number | null; timedOut: boolean; styled: boolean } | null;
}

const describeHit = (stream: string, hit: StyleHit): string =>
    `${stream} line ${hit.line}: ${hit.text}`;

/** The first verdict the pipe run alone can settle, if any. */
function judgePipe(pipe: RunResult): Judgement | undefined {
    if (pipe.spawnError) return { verdict: 'error', reason: `could not start: ${pipe.spawnError}` };
    if (pipe.timedOut) return { verdict: 'error', reason: 'timed out on a normal run' };
    const stdoutHit = findStyle(pipe.stdout.toString('utf8'));
    if (stdoutHit) {
        return {
            verdict: 'fail',
            reason: 'printed color codes into a pipe',
            evidence: describeHit('stdout', stdoutHit),
        };
    }
    const stderrHit = findStyle(pipe.stderr);
    if (stderrHit) {
        return {
            verdict: 'warn',
            reason: 'printed color codes to stderr when it was a pipe',
            evidence: describeHit('stderr', stderrHit),
        };
    }
    return undefined;
}

export function judgeColor(runs: ColorRuns): Judgement {
    const fromPipe = judgePipe(runs.pipe);
    if (fromPipe) return fromPipe;
    const { tty, noColor } = runs;
    if (!tty) {
        return {
            verdict: 'skip',
            reason: `no color in a pipe; no terminal to compare with (${runs.noPty ?? 'no PTY'})`,
        };
    }
    if (tty.timedOut) {
        return {
            verdict: 'skip',
            reason: 'no color in a pipe; in a terminal it waited for input, so it was not compared',
        };
    }
    if (!findStyle(tty.output)) {
        const printed = runs.pipe.stdoutBytes > 0 || runs.pipe.stderr.length > 0 || tty.output;
        if (!printed) {
            return { verdict: 'skip', reason: 'printed nothing, so there is no color to check' };
        }
        return { verdict: 'pass', reason: 'no color in a pipe or in a terminal' };
    }
    if (!noColor || noColor.timedOut) {
        return {
            verdict: 'skip',
            reason: 'colors only in a terminal; the NO_COLOR run did not finish',
        };
    }
    const noColorHit = findStyle(noColor.output);
    if (noColorHit) {
        return {
            verdict: 'warn',
            reason: 'ignores NO_COLOR: still prints color in a terminal',
            evidence: describeHit('terminal', noColorHit),
        };
    }
    return { verdict: 'pass', reason: 'colors only in a terminal, and NO_COLOR turns it off' };
}

/** Runs only as many probes as the verdict needs: a pipe, then a terminal, then NO_COLOR. */
async function colorRuns(
    command: string,
    args: readonly string[],
    timeout: number
): Promise<ColorRuns> {
    const pipe = await run(command, args, { timeout, env: COLOR_ENV });
    if (judgePipe(pipe)) return { pipe };
    const support = ptySupport();
    if (!support.ok) return { pipe, noPty: support.reason };
    const tty = await runPty(command, args, { timeout, env: COLOR_ENV });
    if (tty.timedOut || !findStyle(tty.output)) return { pipe, tty };
    const noColor = await runPty(command, args, { timeout, env: { ...COLOR_ENV, NO_COLOR: '1' } });
    return { pipe, tty, noColor };
}

const summarize = (r: PtyResult | undefined): ColorResult['tty'] =>
    r
        ? { exitCode: r.exitCode, timedOut: r.timedOut, styled: findStyle(r.output) !== undefined }
        : null;

export async function color(
    command: string,
    args: readonly string[],
    timeout: number
): Promise<ColorResult> {
    const runs = await colorRuns(command, args, timeout);
    return {
        check: 'color',
        invocation: [command, ...args],
        ...judgeColor(runs),
        pipe: {
            exitCode: runs.pipe.exitCode,
            stdoutStyled: findStyle(runs.pipe.stdout.toString('utf8')) !== undefined,
            stderrStyled: findStyle(runs.pipe.stderr) !== undefined,
        },
        tty: summarize(runs.tty),
        noColor: summarize(runs.noColor),
    };
}

export const colorCheck: Check = {
    name: 'color',
    kind: 'check',
    summary: 'prints color codes into pipes, or ignores NO_COLOR in a terminal',
    async run(target, ctx) {
        const results: Result[] = [];
        for (const args of target.invocations) {
            results.push(await color(target.command, args, ctx.timeout));
        }
        return results;
    },
};
