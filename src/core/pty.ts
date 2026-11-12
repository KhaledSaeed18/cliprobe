import { execFileSync } from 'node:child_process';
import {
    closeSync,
    constants,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.ts';

/**
 * A pseudo-terminal without native dependencies, built on script(1).
 * The quirks handled here were measured on macOS 27 (BSD script) and Debian 12
 * (util-linux 2.38); see the PTY notes in the repository's design record.
 */

export type PtyFlavor = 'bsd' | 'util-linux';
export type PtySupport = { ok: true; flavor: PtyFlavor } | { ok: false; reason: string };

/** script(1) leaves the terminal at 0x0, which some programs mishandle. */
export const PTY_COLS = 80;
export const PTY_ROWS = 24;

let cached: PtySupport | undefined;

/** Whether this machine can run a program under a PTY, detected once. */
export function ptySupport(): PtySupport {
    cached ??= detect();
    return cached;
}

function detect(): PtySupport {
    if (process.platform === 'darwin') {
        try {
            execFileSync('script', ['-q', '/dev/null', 'true'], { stdio: 'ignore', timeout: 5000 });
            return { ok: true, flavor: 'bsd' };
        } catch {
            return { ok: false, reason: 'script(1) did not run' };
        }
    }
    if (process.platform === 'linux') {
        try {
            const version = execFileSync('script', ['--version'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 5000,
            });
            if (version.includes('util-linux')) return { ok: true, flavor: 'util-linux' };
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return {
                    ok: false,
                    reason: 'script(1) not found; install util-linux (Debian and Ubuntu: bsdutils; Alpine: util-linux-misc)',
                };
            }
        }
        // BusyBox script has no -e, so it cannot report the program's exit code.
        return { ok: false, reason: 'script(1) is not the util-linux version' };
    }
    return { ok: false, reason: `no PTY support on ${process.platform}` };
}

/** Quotes one argument for a POSIX shell. */
export function shellQuote(arg: string): string {
    return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * The script(1) arguments that run `command args...` under a PTY.
 *
 * A small /bin/sh wrapper writes its PID to `pidFile`, sets the window size and
 * then execs the program, so the PID is the program's and the program leads its
 * own session and process group. Everything after the script reaches the
 * program as argv; only the util-linux form needs quoting, because its -c takes
 * a single string.
 */
export function ptyArgs(
    flavor: PtyFlavor,
    pidFile: string,
    command: string,
    args: readonly string[],
    cols: number = PTY_COLS,
    rows: number = PTY_ROWS
): string[] {
    const setup = `echo $$ > "$1"; shift; stty cols ${cols} rows ${rows} 2>/dev/null; exec "$@"`;
    const argv = [pidFile, command, ...args];
    if (flavor === 'bsd') return ['-q', '/dev/null', '/bin/sh', '-c', setup, 'sh', ...argv];
    const line = `exec /bin/sh -c ${shellQuote(setup)} sh ${argv.map(shellQuote).join(' ')}`;
    // -e: exit with the program's status. -c runs the line with SHELL, set to /bin/sh below.
    return ['-qec', line, '/dev/null'];
}

/** BSD script echoes the EOF it forwards from /dev/null as "^D" and two backspaces. */
const BSD_EOF_ECHO = '^D\b\b';

/** Undoes the terminal's output processing: the EOF echo, and \n turned into \r\n. */
export function cleanPtyOutput(raw: Buffer, flavor: PtyFlavor): string {
    let text = raw.toString('utf8');
    if (flavor === 'bsd' && text.startsWith(BSD_EOF_ECHO)) text = text.slice(BSD_EOF_ECHO.length);
    return text.replaceAll('\r\n', '\n');
}

export interface PtyOptions {
    timeout: number;
    /** Changes to the minimal environment; `undefined` removes a variable. */
    env?: Readonly<Record<string, string | undefined>>;
    /**
     * Type `data` into the terminal after a delay, as on a keyboard. stdin is then
     * a terminal that stays open, instead of one that reads a single EOF.
     */
    input?: { data: string; afterMs: number };
}

export interface PtyResult {
    /** stdout and stderr together, as a terminal shows them, cleaned up. */
    output: string;
    /**
     * The program's exit code. Unreliable for signals (BSD reports N, util-linux
     * 128+N) and for a missing command (1 or 127), so run the program without a
     * PTY first to learn whether it starts at all.
     */
    exitCode: number | null;
    /** Timed out, often because the program waited for input after its one EOF. */
    timedOut: boolean;
    spawnError?: string;
    /** Anything script(1) itself printed on its own stderr. */
    scriptStderr: string;
    /** True when the output passed run()'s 1 MiB cap, so its end is missing. */
    truncated: boolean;
    /** When `options.input` was typed, in milliseconds after start; absent if the program exited first. */
    inputSentMs?: number;
}

/**
 * Runs a program with stdin, stdout and stderr on a PTY, an 80x24 window and
 * TERM=xterm-256color. Without `input`, stdin is /dev/null behind the PTY: the
 * program reads one EOF, and a second read blocks until the timeout. With it,
 * the terminal's line discipline handles what is typed, so Ctrl-C (\x03) becomes
 * SIGINT for the program, or a keypress if the program turned that off.
 */
export async function runPty(
    command: string,
    args: readonly string[],
    { timeout, env = {}, input }: PtyOptions
): Promise<PtyResult> {
    const support = ptySupport();
    if (!support.ok) throw new Error(`no PTY: ${support.reason}`);
    const dir = mkdtempSync(join(tmpdir(), 'cliprobe-pty-'));
    const pidFile = join(dir, 'pid');
    let launcher = 'script';
    let argv = ptyArgs(support.flavor, pidFile, command, args);
    let keyboard: number | undefined;
    let inputSentMs: number | undefined;
    let typeTimer: NodeJS.Timeout | undefined;
    let watchTimer: NodeJS.Timeout | undefined;
    const closeKeyboard = (): void => {
        if (keyboard !== undefined) closeSync(keyboard);
        keyboard = undefined;
    };
    const start = performance.now();
    if (input) {
        // script(1) types what arrives on its stdin into the terminal. BSD script
        // refuses a socket there, and on macOS both Node's pipes and FIFOs are
        // sockets, so a real pipe from cat feeds it. cliprobe holds the FIFO open
        // read-write, so cat never sees EOF early and a write never fails.
        const fifo = join(dir, 'keyboard');
        execFileSync('mkfifo', [fifo]);
        keyboard = openSync(fifo, constants.O_RDWR);
        argv = [
            '-c',
            'cat -- "$1" 2>/dev/null | { shift; exec script "$@"; }',
            'sh',
            fifo,
            ...argv,
        ];
        launcher = '/bin/sh';
        typeTimer = setTimeout(() => {
            if (programState(pidFile) !== 'running') return;
            inputSentMs = Math.round(performance.now() - start);
            if (keyboard !== undefined) writeSync(keyboard, input.data);
        }, input.afterMs);
        // BSD script waits for EOF on its stdin even after the program exits, so
        // once the program is gone, end the keyboard: cat exits, then script.
        watchTimer = setInterval(() => {
            if (programState(pidFile) !== 'gone') return;
            clearInterval(watchTimer);
            closeKeyboard();
        }, EXIT_POLL_MS);
    }
    try {
        const result = await run(launcher, argv, {
            timeout,
            // An empty SHELL breaks util-linux script; BSD script ignores it.
            env: { TERM: 'xterm-256color', SHELL: '/bin/sh', ...env },
            // The program has its own session, so killing script's group misses it, and
            // one that ignores SIGHUP would outlive script. Kill its group first.
            beforeKill: () => killGroupFromPidFile(pidFile),
        });
        return {
            output: cleanPtyOutput(result.stdout, support.flavor),
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            ...(result.spawnError === undefined ? {} : { spawnError: result.spawnError }),
            scriptStderr: result.stderr,
            truncated: result.stdoutBytes > result.stdout.length,
            ...(inputSentMs === undefined ? {} : { inputSentMs }),
        };
    } finally {
        clearTimeout(typeTimer);
        clearInterval(watchTimer);
        closeKeyboard();
        rmSync(dir, { recursive: true, force: true });
    }
}

/** How often to look for the end of a program that is being typed to. */
const EXIT_POLL_MS = 50;

function programGroup(pidFile: string): number | undefined {
    try {
        const pid = Number(readFileSync(pidFile, 'utf8').trim());
        return Number.isInteger(pid) && pid > 1 ? pid : undefined;
    } catch {
        return undefined; // not written yet
    }
}

/**
 * Whether the program under the PTY has started, is running, or has exited.
 * Asks about the program itself, which script(1) reaps, not its group: a child
 * it left behind can stay a zombie for good where nothing reaps orphans, as in
 * a container without an init process.
 */
function programState(pidFile: string): 'starting' | 'running' | 'gone' {
    const pid = programGroup(pidFile);
    if (pid === undefined) return 'starting';
    try {
        process.kill(pid, 0);
        return 'running';
    } catch {
        return 'gone';
    }
}

function killGroupFromPidFile(pidFile: string): void {
    const pid = programGroup(pidFile);
    try {
        if (pid !== undefined) process.kill(-pid, 'SIGKILL');
    } catch {
        // Already gone; killing script's group still follows.
    }
}
