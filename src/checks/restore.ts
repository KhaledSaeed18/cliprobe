import { findOpenModes, type OpenMode } from '../core/ansi.ts';
import { ptySupport, runPty, type PtyResult } from '../core/pty.ts';
import type { Check, Judgement, Result } from '../core/types.ts';
import { cannotExecute, findCommand, notAProgram } from '../core/which.ts';
import { CTRL_C_DELAY_MS, CTRL_C_GRACE_MS } from './ctrl-c.ts';

export interface RestoreResult extends Result {
    /** Whether Ctrl-C was sent; false when the program exited first. */
    interrupted: boolean;
    /** The modes it left switched on, with the sequence that switched each on. */
    openModes: OpenMode[];
}

function listLabels(modes: readonly OpenMode[]): string {
    const labels = modes.map((m) => m.label);
    return labels.length <= 1
        ? (labels[0] ?? '')
        : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}

/** The PTY wrapper's own complaint when it can't exec the program. */
const WRAPPER_EXEC_FAILED = /^sh: [^\n]*(cannot execute|exec format error)/i;

/** What the Ctrl-C key sends to a terminal. */
const CTRL_C_KEY = '\x03';

export function judgeRestore(r: PtyResult): Judgement {
    if (r.spawnError) return { verdict: 'error', reason: `could not start: ${r.spawnError}` };
    const interrupted = r.inputSentMs !== undefined;
    if (r.timedOut) {
        return {
            verdict: 'skip',
            reason: interrupted
                ? `still running ${CTRL_C_GRACE_MS / 1000} s after Ctrl-C, so how it leaves the terminal wasn't seen (REPLs and some full-screen programs quit only on a second Ctrl-C)`
                : 'waited for input in a terminal, so it never finished',
        };
    }
    if (r.truncated) {
        return {
            verdict: 'skip',
            reason: 'printed more than 1 MiB in a terminal, so the end of its output, where it would restore the terminal, was not kept',
        };
    }
    const when = interrupted ? 'after Ctrl-C' : 'when it exited';
    const open = findOpenModes(r.output);
    if (open.length > 0) {
        return {
            verdict: 'warn',
            reason: `left the terminal with ${listLabels(open)} ${when}`,
            evidence: open.map((m) => `${m.sequence} on line ${m.line}, never undone`).join('; '),
        };
    }
    return { verdict: 'pass', reason: `left no terminal mode switched on ${when}` };
}

export async function restore(
    command: string,
    args: readonly string[],
    { timeout, interrupt }: { timeout: number; interrupt: boolean }
): Promise<RestoreResult> {
    const r = await runPty(command, args, {
        timeout: interrupt ? CTRL_C_DELAY_MS + CTRL_C_GRACE_MS : timeout,
        // Typed, not signalled: a program that turned off the terminal's Ctrl-C (raw
        // mode, as full-screen programs and prompts do) gets it as a key, as it would.
        ...(interrupt ? { input: { data: CTRL_C_KEY, afterMs: CTRL_C_DELAY_MS } } : {}),
    });
    // Under a PTY, a file this system can't run is only the complaint of the shell
    // that execs it ("sh: ./x: cannot execute binary file"), and BSD script reports
    // its exit as 1, so either sign counts, on a file no shell would run.
    const notRun =
        r.spawnError === undefined &&
        (r.exitCode === 126 || r.exitCode === 127 || WRAPPER_EXEC_FAILED.test(r.output)) &&
        cannotExecute(command);
    const judgement = judgeRestore(
        notRun
            ? { ...r, spawnError: notAProgram(command, "the terminal's shell could not exec it") }
            : r
    );
    return {
        check: 'restore',
        invocation: [command, ...args],
        ...judgement,
        interrupted: r.inputSentMs !== undefined,
        openModes: judgement.verdict === 'warn' ? findOpenModes(r.output) : [],
    };
}

export const restoreCheck: Check = {
    name: 'restore',
    kind: 'check',
    summary: 'leaves the cursor hidden, the alternate screen or mouse mode on after Ctrl-C',
    async run(target, ctx) {
        const support = ptySupport();
        // Under a PTY a missing command is only a line of shell output, so ask first.
        const notRun: Judgement | undefined =
            findCommand(target.command) === undefined
                ? { verdict: 'error', reason: 'could not start: command not found' }
                : support.ok
                  ? undefined
                  : { verdict: 'skip', reason: `needs a terminal (${support.reason})` };
        const results: Result[] = [];
        for (const { args, own } of target.probes) {
            if (notRun) {
                const result: RestoreResult = {
                    check: 'restore',
                    invocation: [target.command, ...args],
                    ...notRun,
                    interrupted: false,
                    openModes: [],
                };
                results.push(result);
                continue;
            }
            // Probes the user named often keep running, so they get Ctrl-C, as a person
            // would send. --version and --help just exit, and are judged as they leave.
            results.push(
                await restore(target.command, args, {
                    timeout: ctx.timeout,
                    interrupt: own,
                })
            );
        }
        return results;
    },
};
