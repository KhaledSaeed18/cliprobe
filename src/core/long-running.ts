import type { Context } from './types.ts';

/**
 * Once one check has seen a probe still running at the timeout (a server, a
 * watcher, a full-screen program), later checks watch it this long instead, so
 * the timeout is paid once rather than once per check.
 */
export const LONG_RUN_WINDOW_MS = 3000;

const key = (command: string, args: readonly string[]): string =>
    JSON.stringify([command, ...args]);

export function isLongRunning(ctx: Context, command: string, args: readonly string[]): boolean {
    return ctx.longRunning?.has(key(command, args)) === true;
}

/** How long to let a normal run of this probe go: the timeout, or the short window once it is known to keep running. */
export function probeTimeout(ctx: Context, command: string, args: readonly string[]): number {
    return isLongRunning(ctx, command, args)
        ? Math.min(ctx.timeout, LONG_RUN_WINDOW_MS)
        : ctx.timeout;
}

export function markLongRunning(ctx: Context, command: string, args: readonly string[]): void {
    ctx.longRunning?.add(key(command, args));
}

/** "still running after 15 s", from a run that was stopped at its timeout. */
export const stillRunning = (durationMs: number): string =>
    `still running after ${Math.round(durationMs / 1000)} s`;
