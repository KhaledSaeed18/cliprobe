import { HOSTILE_NAMES, type HostileName, PLAIN_NAME } from '../core/fixture.ts';
import { ptySupport, runPty, type PtyResult } from '../core/pty.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Judgement, Result } from '../core/types.ts';

const ENV = { TERM: 'xterm-256color', CI: undefined } as const;

/** What the runs saw. Runs after the verdict was settled are left out. */
export interface ControlCharsRuns {
    /** False when no argument held {fixture}, so there were no hostile names to print. */
    usesFixture: boolean;
    pipe?: RunResult;
    tty?: PtyResult;
    noPty?: string;
}

export interface ControlCharsResult extends Result {
    /** Kinds of hostile names that reached the terminal unescaped. */
    terminalRaw: string[];
    /** Kinds that reached a pipe unescaped. Normal for ls and find, so not judged. */
    pipeRaw: string[];
}

/** The hostile names whose dangerous part appears in the output unescaped. */
export function rawNames(output: string): HostileName[] {
    return HOSTILE_NAMES.filter((h) => output.includes(h.marker));
}

const listLabels = (names: readonly HostileName[]): string => {
    const labels = names.map((h) => h.label);
    return labels.length <= 1
        ? (labels[0] ?? '')
        : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
};

const evidenceFor = (names: readonly HostileName[]): string =>
    `file names printed raw: ${names.map((h) => h.name).join(', ')}`;

export function judgeControlChars(runs: ControlCharsRuns): Judgement {
    if (!runs.usesFixture) {
        return {
            verdict: 'skip',
            reason: 'no {fixture} in the arguments; put it where the command takes a path, e.g. ls {fixture}',
        };
    }
    const { pipe, tty } = runs;
    if (pipe?.spawnError) {
        return { verdict: 'error', reason: `could not start: ${pipe.spawnError}` };
    }
    if (pipe?.timedOut) return { verdict: 'error', reason: 'timed out on a normal run' };
    if (!tty) {
        return { verdict: 'skip', reason: `no terminal to check with (${runs.noPty ?? 'no PTY'})` };
    }
    if (tty.timedOut) return { verdict: 'skip', reason: 'waited for input in a terminal' };
    if (!tty.output.includes(PLAIN_NAME)) {
        return {
            verdict: 'skip',
            reason: 'did not print the file names in {fixture}, so there was nothing to escape',
        };
    }
    const raw = rawNames(tty.output);
    const failing = raw.filter((h) => h.severity === 'fail');
    if (failing.length) {
        return {
            verdict: 'fail',
            reason: `sent ${failing.length > 1 ? 'escape sequences' : 'an escape sequence'} from file names to the terminal unescaped`,
            evidence: evidenceFor(failing),
        };
    }
    const warning = raw.filter((h) => h.severity === 'warn');
    if (warning.length) {
        return {
            verdict: 'warn',
            reason: `printed ${listLabels(warning)} from file names unescaped, which can hide or forge output`,
            evidence: evidenceFor(warning),
        };
    }
    const noted = raw.filter((h) => h.severity === 'note');
    const note = noted.length ? `; printed ${listLabels(noted)} as is` : '';
    return { verdict: 'pass', reason: `escaped control characters in file names${note}` };
}

async function controlCharsRuns(
    command: string,
    args: readonly string[],
    fixtureDir: string | undefined,
    timeout: number
): Promise<ControlCharsRuns> {
    const usesFixture = fixtureDir !== undefined && args.some((a) => a.includes(fixtureDir));
    if (!usesFixture) return { usesFixture };
    const pipe = await run(command, args, { timeout, env: ENV });
    if (pipe.spawnError || pipe.timedOut) return { usesFixture, pipe };
    const support = ptySupport();
    if (!support.ok) return { usesFixture, pipe, noPty: support.reason };
    // Judged under a terminal: that is where an escape sequence takes effect. Into a
    // pipe, printing names exactly is what ls and find are meant to do.
    const tty = await runPty(command, args, { timeout, env: ENV });
    return { usesFixture, pipe, tty };
}

const kinds = (output: string | undefined): string[] =>
    output === undefined ? [] : rawNames(output).map((h) => h.kind);

export async function controlChars(
    command: string,
    args: readonly string[],
    fixtureDir: string | undefined,
    timeout: number
): Promise<ControlCharsResult> {
    const runs = await controlCharsRuns(command, args, fixtureDir, timeout);
    const pipeOutput = runs.pipe && runs.pipe.stdout.toString('utf8') + runs.pipe.stderr;
    return {
        check: 'control-chars',
        invocation: [command, ...args],
        ...judgeControlChars(runs),
        terminalRaw: kinds(runs.tty?.output),
        pipeRaw: kinds(pipeOutput),
    };
}

export const controlCharsCheck: Check = {
    name: 'control-chars',
    kind: 'check',
    summary: 'prints control characters from file names raw to the terminal',
    async run(target, ctx) {
        if (target.fixtureDir === undefined) {
            // Nothing to plant, so nothing to run: one line instead of a skip per probe.
            const skip: ControlCharsResult = {
                check: 'control-chars',
                invocation: [target.command],
                ...judgeControlChars({ usesFixture: false }),
                terminalRaw: [],
                pipeRaw: [],
            };
            return [skip];
        }
        const results: Result[] = [];
        for (const args of target.invocations) {
            results.push(await controlChars(target.command, args, target.fixtureDir, ctx.timeout));
        }
        return results;
    },
};
