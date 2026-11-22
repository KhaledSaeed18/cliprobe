import {
    accessSync,
    constants,
    lstatSync,
    readlinkSync,
    realpathSync,
    rmSync,
    type Stats,
    statSync,
} from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { onInterrupt } from '../core/interrupt.ts';

/** Why a report can't be written to a path, in words for the person who gave it. */
export class ReportPathError extends Error {}

/**
 * How a report reaches its path. `replace`: a temporary file next to the real
 * file (symlinks resolved), renamed over it, so nothing ever reads half a
 * report; an existing file keeps its mode. `direct`: opened and written in
 * place, for a FIFO, a terminal, /dev/stdout or /dev/fd/N, which a rename would
 * replace, or a file in a folder cliprobe may not write.
 */
export type ReportTarget =
    { how: 'replace'; path: string; mode: number | undefined } | { how: 'direct'; path: string };

const allowed = (path: string, mode: number): boolean => {
    try {
        accessSync(path, mode);
        return true;
    } catch {
        return false;
    }
};
/** The errno code of a failed file system call, such as ENOENT. */
const errorCode = (error: unknown): unknown =>
    error instanceof Error && 'code' in error ? error.code : undefined;

/** A folder in which cliprobe may create and rename files. */
const writableFolder = (path: string): boolean => allowed(path, constants.W_OK | constants.X_OK);

/** stat() that follows symlinks, undefined for a path that doesn't exist (or runs through a file). */
function statPath(path: string): Stats | undefined {
    try {
        return statSync(path);
    } catch (error) {
        const code = errorCode(error);
        if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
        throw new ReportPathError(describe(error));
    }
}

/** A symlink's final target, followed even when that target doesn't exist yet. */
function followLinks(path: string): string {
    let current = resolve(path);
    for (let hops = 0; hops < 40; hops++) {
        let st: Stats | undefined;
        try {
            st = lstatSync(current);
        } catch {
            return current; // missing, or under a file: the folder check below says which
        }
        if (!st.isSymbolicLink()) return current;
        current = resolve(dirname(current), readlinkSync(current));
    }
    throw new ReportPathError('too many levels of symbolic links');
}

/**
 * Decides how to write a report to `path`, or throws a ReportPathError that says
 * why it can't be written. It changes nothing on disk, so the same rule serves
 * the check before any probe runs and the write at the end.
 */
export function reportTarget(path: string): ReportTarget {
    // stat() follows symlinks, so a link to a FIFO or a device counts as one.
    const st = statPath(path);
    if (st?.isDirectory()) throw new ReportPathError('is a directory');
    // /dev/stdout, /dev/fd/N and the like name an open file: write through it, as a shell would.
    if (st && (!st.isFile() || /^\/(dev|proc)\//.test(resolve(path)))) {
        return { how: 'direct', path };
    }
    if (st) {
        const real = realpathSync(path);
        const mode = st.mode & 0o7777;
        if (writableFolder(dirname(real))) return { how: 'replace', path: real, mode };
        // No temporary file can go next to it, but the file itself may be writable.
        if (allowed(real, constants.W_OK)) return { how: 'direct', path: real };
        throw new ReportPathError('permission denied');
    }
    if (path.endsWith(sep) || path.endsWith(`${sep}.`)) {
        throw new ReportPathError('names a folder, not a file');
    }
    // A new file: its nearest existing ancestor must be a folder cliprobe may write,
    // where the missing folders in between are created.
    const target = followLinks(path);
    let ancestor = dirname(target);
    let ancestorStat = statPath(ancestor);
    while (!ancestorStat && dirname(ancestor) !== ancestor) {
        ancestor = dirname(ancestor);
        ancestorStat = statPath(ancestor);
    }
    if (!ancestorStat?.isDirectory()) throw new ReportPathError(`${ancestor} is not a folder`);
    if (!writableFolder(ancestor)) throw new ReportPathError('permission denied');
    return { how: 'replace', path: target, mode: undefined };
}

/** A failed write in words, without the temporary file's name that the raw error gives. */
function describe(error: unknown): string {
    if (error instanceof ReportPathError) return error.message;
    const code = errorCode(error);
    if (code === 'ELOOP') return 'too many levels of symbolic links';
    if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
    if (code === 'ENOSPC') return 'no space left on the device';
    if (code === 'EROFS') return 'read-only file system';
    if (code === 'EISDIR') return 'is a directory';
    return error instanceof Error ? error.message : String(error);
}

/**
 * Checks `path` the way writeReportFile will write it, and returns why it can't
 * be written, or undefined when it can.
 */
export function reportPathProblem(path: string): string | undefined {
    try {
        reportTarget(path);
        return undefined;
    } catch (error) {
        return describe(error);
    }
}

/**
 * Writes a report to `path` as reportTarget decides: a regular file is replaced
 * whole (missing parent folders are created), anything else is written in
 * place. Asynchronous, so that a FIFO nobody reads yet doesn't block the
 * signal handlers. Throws an Error that says why on failure, leaving no
 * temporary file, even if cliprobe is interrupted meanwhile.
 */
export async function writeReportFile(path: string, text: string): Promise<void> {
    let target: ReportTarget;
    try {
        target = reportTarget(path);
    } catch (error) {
        throw new Error(describe(error), { cause: error });
    }
    if (target.how === 'direct') {
        try {
            await writeFile(target.path, text);
        } catch (error) {
            throw new Error(describe(error), { cause: error });
        }
        return;
    }
    const temp = `${target.path}.cliprobe-${process.pid}.tmp`;
    const unregister = onInterrupt(() => rmSync(temp, { force: true }));
    try {
        await mkdir(dirname(target.path), { recursive: true });
        await writeFile(temp, text);
        // The umask applies to a new file; an existing report keeps its own mode.
        if (target.mode !== undefined) await chmod(temp, target.mode);
        await rename(temp, target.path);
    } catch (error) {
        await rm(temp, { force: true });
        throw new Error(describe(error), { cause: error });
    } finally {
        unregister();
    }
}
