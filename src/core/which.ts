import { accessSync, closeSync, constants, openSync, readSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

function isExecutableFile(path: string): boolean {
    try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

/**
 * Where `command` would be found, as spawn() looks for it: a path with a slash
 * as given, otherwise each PATH entry in turn (an empty entry is the current
 * directory). Under a PTY, a missing command is only a line of shell output, so
 * the terminal checks ask first.
 */
export function findCommand(
    command: string,
    path: string = process.env['PATH'] ?? '/usr/bin:/bin'
): string | undefined {
    if (command.includes('/')) return isExecutableFile(command) ? command : undefined;
    for (const dir of path.split(delimiter)) {
        const candidate = join(dir || '.', command);
        if (isExecutableFile(candidate)) return candidate;
    }
    return undefined;
}

/** The first bytes of a file, or nothing when it can't be read (execute-only, say). */
function head(path: string, bytes = 512): Buffer {
    let fd: number | undefined;
    try {
        fd = openSync(path, 'r');
        const buffer = Buffer.alloc(bytes);
        return buffer.subarray(0, readSync(fd, buffer, 0, bytes, 0));
    } catch {
        return Buffer.alloc(0);
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/** Why the interpreter named on a `#!` line can't run, if it can't. */
function interpreterProblem(command: string, file: string, path: string): string | undefined {
    const start = head(file, 256);
    if (start.subarray(0, 2).toString('latin1') !== '#!') return undefined;
    const line = start.toString('utf8').slice(2).split('\n')[0] ?? '';
    const [interpreter = '', first] = line.trim().split(/[ \t]+/);
    if (interpreter === '') return undefined;
    try {
        statSync(interpreter);
    } catch {
        return `${command}: interpreter ${interpreter} not found`;
    }
    if (!isExecutableFile(interpreter)) {
        return `${command}: interpreter ${interpreter} is not executable`;
    }
    // #!/usr/bin/env node: env looks the program up on PATH, as the probe will.
    if (/(^|\/)env$/.test(interpreter) && first !== undefined && !first.startsWith('-')) {
        if (!first.includes('=') && findCommand(first, path) === undefined) {
            return `${command}: interpreter ${first} not found (${interpreter} ${first})`;
        }
    }
    return undefined;
}

/**
 * Why `command` can't run, or undefined if it looks runnable: not found, a
 * directory, not executable, or a `#!` interpreter that is missing. Asked before
 * any check, so the user sees the cause once instead of an error per probe.
 */
export function commandProblem(
    command: string,
    path: string = process.env['PATH'] ?? '/usr/bin:/bin'
): string | undefined {
    if (command.includes('/')) {
        let isFile: boolean;
        try {
            const stat = statSync(command);
            if (stat.isDirectory()) return `${command} is a directory`;
            isFile = stat.isFile();
        } catch {
            return `command not found: ${command}`;
        }
        if (!isFile) return `${command} is not a regular file`;
        if (!isExecutableFile(command)) return `${command} is not executable (chmod +x?)`;
        return interpreterProblem(command, command, path);
    }
    const file = findCommand(command, path);
    if (file === undefined) return `command not found: ${command}`;
    return interpreterProblem(command, file, path);
}

/** The reason given for a file this system can't run as a program. */
export const notAProgram = (command: string, how: string): string =>
    `${command} is not a program this system can run (${how})`;

/**
 * Whether `command` resolves to a file that no shell or kernel would run as a
 * program of this system: no `#!` line, and a NUL byte near its start, which no
 * script has. Alone this could be a binary run through binfmt_misc, so callers
 * also need the run to have exited 126 or 127.
 */
export function cannotExecute(
    command: string,
    path: string = process.env['PATH'] ?? '/usr/bin:/bin'
): boolean {
    const file = findCommand(command, path);
    if (file === undefined) return false;
    const start = head(file);
    return start.subarray(0, 2).toString('latin1') !== '#!' && start.includes(0);
}

/**
 * Whether a run ended because the system could not run the file at all. On
 * Linux, spawn() hands a file the kernel can't execute (ENOEXEC) to /bin/sh,
 * as execvp() does, so a binary that isn't one for this system "runs" and exits
 * 126 or 127 with the shell's complaint, prefixed by the file's path. Only a
 * file with no `#!` line and a NUL byte near its start counts, as no script has
 * one: a binary run through binfmt_misc, or a script without `#!`, is left alone.
 * Returns the reason, or undefined.
 */
export function shellFallbackError(
    command: string,
    exitCode: number | null,
    stderr: string,
    path: string = process.env['PATH'] ?? '/usr/bin:/bin'
): string | undefined {
    if (exitCode !== 126 && exitCode !== 127) return undefined;
    const file = findCommand(command, path);
    if (file === undefined || !cannotExecute(command, path)) return undefined;
    if (!stderr.startsWith(`${command}: `) && !stderr.startsWith(`${file}: `)) return undefined;
    return notAProgram(command, `/bin/sh tried it as a script and exited ${exitCode}`);
}
