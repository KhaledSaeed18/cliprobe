import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { closeSync, constants, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
    type GroupMember,
    killAll,
    type ProcessInfo,
    processTable,
    processTableAsync,
    ProcessTree,
} from './group.ts';
import { onInterrupt } from './interrupt.ts';
import { sandbox } from './sandbox.ts';
import { notAProgram, shellFallbackError } from './which.ts';

const STDERR_CAP = 64 * 1024;
const STDOUT_CAP = 1024 * 1024;

export interface RunOptions {
    /** Make stdout a pipe whose read end is already closed. */
    closedStdout?: boolean;
    /** Kill the whole process group after this many milliseconds. */
    timeout: number;
    /** Changes to the minimal environment; `undefined` removes a variable. */
    env?: Readonly<Record<string, string | undefined>>;
    /**
     * Another process group that belongs to the run, read when it is needed: the
     * program's own under a pseudo-terminal, where the spawned process is script(1).
     */
    extraGroup?: () => number | undefined;
    /**
     * Send this signal after a delay: to the process group, as a terminal does on
     * Ctrl-C, or with `to: 'process'` to the program alone, as `kill <pid>`,
     * `docker stop` and process managers do. Not sent if the program has already exited.
     */
    signal?: { name: NodeJS.Signals; afterMs: number; to?: 'group' | 'process' };
    /**
     * Once the program exits, how long the processes it left running (in its
     * group, or started by it in another one) get to finish on their own before
     * they are killed. Checks that report them in `leftRunning` give them longer
     * than the default, AFTER_EXIT_GRACE_MS.
     */
    leftoversMs?: number;
    /**
     * What stdin is: 'null' (/dev/null, the default), 'open' (a pipe that nobody
     * writes to and that stays open, as agents and CI runners often leave it), or
     * a pipe closed after a delay.
     */
    stdin?: 'null' | 'open' | { closeAfterMs: number };
}

export interface RunResult {
    /** Total bytes written to stdout. */
    stdoutBytes: number;
    /** The first 1 MiB of stdout. */
    stdout: Buffer;
    stderr: string;
    timedOut: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError?: string;
    /**
     * Wall time from spawn to the program's own exit, in milliseconds, not
     * counting the wait for what it left behind.
     */
    durationMs: number;
    /** When `options.signal` was sent, in milliseconds after spawn; absent if it was not. */
    signalSentMs?: number;
    /** Length of `stderr` when the signal was sent, to tell output before it from after. */
    stderrAtSignal?: number;
    /**
     * Processes it left running once it exited (before the timeout), in its group
     * or started by it, that had not finished `leftoversMs` later. All are killed.
     */
    leftRunning?: GroupMember[];
}

type Outcome = Pick<RunResult, 'exitCode' | 'signal' | 'spawnError'>;

/** How long what a program left running gets to finish on its own, by default. */
export const AFTER_EXIT_GRACE_MS = 250;
/** How often the process table is read while the program runs, to learn its descendants. */
const TREE_POLL_MS = 200;
/** How long to wait for the output pipes to close once everything the run started is gone. */
const CLOSE_WAIT_MS = 1000;
/** How often to look for leftovers while waiting for them to finish. */
const LEFTOVER_POLL_MS = 50;

const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

/**
 * Runs one invocation. With `closedStdout`, stdout is the write end of a FIFO
 * whose read end is closed before the program starts, so its first write to
 * stdout fails (EPIPE, or SIGPIPE for programs that keep the default handler).
 */
export function run(
    command: string,
    args: readonly string[],
    {
        closedStdout = false,
        timeout,
        env: overrides = {},
        extraGroup,
        signal,
        stdin = 'null',
        leftoversMs = AFTER_EXIT_GRACE_MS,
    }: RunOptions
): Promise<RunResult> {
    const { dir, env: base } = sandbox();
    const env: Record<string, string> = { ...base };
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
    }
    let stdoutFd: number | 'pipe' = 'pipe';
    if (closedStdout) {
        const fifo = join(dir, 'stdout.fifo');
        execFileSync('mkfifo', [fifo]);
        const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
        stdoutFd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
        closeSync(reader);
    }

    return new Promise((resolve) => {
        let stdoutBytes = 0;
        const stdoutChunks: Buffer[] = [];
        let stderr = '';
        let timedOut = false;
        let finished = false;
        let exited = false;
        let signalSentMs: number | undefined;
        let stderrAtSignal: number | undefined;
        let leftRunning: GroupMember[] | undefined;
        let exitMs: number | undefined;
        let tree: ProcessTree | undefined;
        let pollTimer: NodeJS.Timeout | undefined;
        const start = performance.now();
        const groups = (): number[] => {
            const extra = extraGroup?.();
            return [
                ...(child?.pid === undefined ? [] : [child.pid]),
                ...(extra === undefined ? [] : [extra]),
            ];
        };
        /** Kills everything the run started, from a fresh look at the process table. */
        const killRun = (): void => {
            if (tree) killAll(tree.running(processTable()), groups());
        };
        // If cliprobe itself is stopped, nothing it started may outlive it.
        const unregister = onInterrupt(() => {
            killRun();
            rmSync(dir, { recursive: true, force: true });
        });
        // A failed spawn emits both "error" and "close"; clean up and resolve once.
        const finish = (outcome: Outcome): void => {
            if (finished) return;
            finished = true;
            clearInterval(pollTimer);
            unregister();
            if (typeof stdoutFd === 'number') closeSync(stdoutFd);
            rmSync(dir, { recursive: true, force: true });
            const stdout = Buffer.concat(stdoutChunks).subarray(0, STDOUT_CAP);
            resolve({
                stdoutBytes,
                stdout,
                stderr,
                timedOut,
                durationMs: exitMs ?? Math.round(performance.now() - start),
                ...(signalSentMs === undefined
                    ? {}
                    : { signalSentMs, stderrAtSignal: stderrAtSignal ?? 0 }),
                ...(leftRunning === undefined ? {} : { leftRunning }),
                ...outcome,
            });
        };
        let child: ChildProcess | undefined;
        try {
            // Runs in the caller's directory, as if typed there, so relative paths such as
            // `node ./dist/cli.js` work. HOME and TMPDIR point at a throwaway directory.
            child = spawn(command, [...args], {
                env,
                stdio: [stdin === 'null' ? 'ignore' : 'pipe', stdoutFd, 'pipe'],
                detached: true,
            });
        } catch (error) {
            finish({ exitCode: null, signal: null, spawnError: spawnMessage(command, error) });
            return;
        }
        const proc = child;
        if (proc.pid !== undefined) {
            tree = new ProcessTree(proc.pid, groups);
            // Children that leave the program's group are only linked to it by their
            // parent PID, which changes once the program exits: note them while it runs.
            let polling = false;
            pollTimer = setInterval(() => {
                if (polling || exited) return;
                polling = true;
                void (async () => {
                    const table = await processTableAsync();
                    polling = false;
                    if (!exited) tree?.record(table);
                })();
            }, TREE_POLL_MS);
        }
        const recordTree = (): void => {
            tree?.record(processTable());
        };
        const timer = setTimeout(() => {
            timedOut = true;
            recordTree();
            killRun();
        }, timeout);
        const signalTimer =
            signal &&
            setTimeout(() => {
                if (exited || proc.pid === undefined) return;
                // The last look while the program runs: what it started so far.
                recordTree();
                signalSentMs = Math.round(performance.now() - start);
                stderrAtSignal = stderr.length;
                try {
                    process.kill(signal.to === 'process' ? proc.pid : -proc.pid, signal.name);
                } catch {
                    // Exited in the meantime.
                }
            }, signal.afterMs);
        // stdin is only ever closed, never written, and destroy() closes it without a
        // write, so a program that already exited can't make it fail with EPIPE.
        const closeTimer =
            typeof stdin === 'object'
                ? setTimeout(() => proc.stdin?.destroy(), stdin.closeAfterMs)
                : undefined;
        let closed = false;
        let onClosed: (() => void) | undefined;
        const outputClosed = new Promise<void>((resolveClosed) => {
            onClosed = resolveClosed;
        });
        proc.on('exit', (exitCode, exitSignal) => {
            exited = true;
            exitMs = Math.round(performance.now() - start);
            // The program is judged on its own exit: the timeout no longer applies, and
            // what it left behind, which may hold the output pipes open, is killed.
            clearTimeout(timer);
            clearTimeout(signalTimer);
            clearTimeout(closeTimer);
            clearInterval(pollTimer);
            tree?.programExited();
            // An open stdin pipe must not keep cliprobe itself running.
            proc.stdin?.destroy();
            void (async () => {
                if (tree) {
                    const left = await watchLeftovers(tree, timedOut ? 0 : leftoversMs);
                    killAll(left, groups());
                    leftRunning = left.map((p) => ({ pid: p.pid, command: p.command }));
                }
                if (!closed) {
                    let giveUp: NodeJS.Timeout | undefined;
                    const gaveUp = new Promise<void>((resolveWait) => {
                        giveUp = setTimeout(resolveWait, CLOSE_WAIT_MS);
                    });
                    await Promise.race([outputClosed, gaveUp]);
                    // A pending timer would keep cliprobe running after its report.
                    clearTimeout(giveUp);
                }
                // Something the run could not see still holds the pipes: stop reading.
                proc.stdout?.destroy();
                proc.stderr?.destroy();
                // A file Linux can't execute was run by /bin/sh instead: it never started.
                const notRun = timedOut ? undefined : shellFallbackError(command, exitCode, stderr);
                finish({
                    exitCode,
                    signal: exitSignal,
                    ...(notRun === undefined ? {} : { spawnError: notRun }),
                });
            })();
        });
        proc.stdout?.on('data', (chunk: Buffer) => {
            if (stdoutBytes < STDOUT_CAP) stdoutChunks.push(chunk);
            stdoutBytes += chunk.length;
        });
        proc.stderr?.on('data', (chunk: Buffer) => {
            if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8');
        });
        proc.on('error', (error) => {
            clearTimeout(timer);
            clearTimeout(signalTimer);
            finish({ exitCode: null, signal: null, spawnError: spawnMessage(command, error) });
        });
        proc.on('close', () => {
            closed = true;
            onClosed?.();
        });
    });
}

/** Why spawn() failed; "spawn ENOEXEC" names neither the file nor the problem. */
function spawnMessage(command: string, error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    return 'code' in error && error.code === 'ENOEXEC'
        ? notAProgram(command, 'exec format error')
        : error.message;
}

/**
 * Waits up to `ms` for what the program left running to finish on its own, as
 * children stopped by their parent take a moment to exit, and returns what is
 * still running then.
 */
async function watchLeftovers(tree: ProcessTree, ms: number): Promise<ProcessInfo[]> {
    const deadline = performance.now() + ms;
    let left = tree.running(processTable());
    while (left.length > 0 && performance.now() < deadline) {
        await delay(LEFTOVER_POLL_MS);
        left = tree.running(processTable());
    }
    return left;
}
