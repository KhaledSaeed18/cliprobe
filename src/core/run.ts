import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { closeSync, constants, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './sandbox.ts';

const STDERR_CAP = 64 * 1024;

export interface RunOptions {
    /** Make stdout a pipe whose read end is already closed. */
    closedStdout: boolean;
    /** Kill the whole process group after this many milliseconds. */
    timeout: number;
}

export interface RunResult {
    stdoutBytes: number;
    stderr: string;
    timedOut: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError?: string;
}

type Outcome = Pick<RunResult, 'exitCode' | 'signal' | 'spawnError'>;

/**
 * Runs one invocation. With `closedStdout`, stdout is the write end of a FIFO
 * whose read end is closed before the program starts, so its first write to
 * stdout fails (EPIPE, or SIGPIPE for programs that keep the default handler).
 */
export function run(
    command: string,
    args: readonly string[],
    { closedStdout, timeout }: RunOptions
): Promise<RunResult> {
    const { dir, env } = sandbox();
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
        let stderr = '';
        let timedOut = false;
        let finished = false;
        // A failed spawn emits both "error" and "close"; clean up and resolve once.
        const finish = (outcome: Outcome): void => {
            if (finished) return;
            finished = true;
            if (typeof stdoutFd === 'number') closeSync(stdoutFd);
            rmSync(dir, { recursive: true, force: true });
            resolve({ stdoutBytes, stderr, timedOut, ...outcome });
        };
        let child: ChildProcess;
        try {
            // Runs in the caller's directory, as if typed there, so relative paths such as
            // `node ./dist/cli.js` work. HOME and TMPDIR point at a throwaway directory.
            child = spawn(command, [...args], {
                env,
                stdio: ['ignore', stdoutFd, 'pipe'],
                detached: true,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            finish({ exitCode: null, signal: null, spawnError: message });
            return;
        }
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
            } catch {
                // Already gone.
            }
        }, timeout);
        child.stdout?.on('data', (chunk: Buffer) => {
            stdoutBytes += chunk.length;
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            finish({ exitCode: null, signal: null, spawnError: error.message });
        });
        child.on('close', (exitCode, signal) => {
            clearTimeout(timer);
            finish({ exitCode, signal });
        });
    });
}
