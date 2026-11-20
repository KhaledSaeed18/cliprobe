/**
 * What to undo if cliprobe itself is interrupted mid-run. Probes run in their own
 * process groups, so the Ctrl-C or SIGTERM that stops cliprobe never reaches
 * them: each live run registers how to kill what it started and remove its
 * temporary directories, and the signal handler runs all of that before exiting.
 */

type Cleanup = () => void;

const cleanups = new Set<Cleanup>();

/** Registers `cleanup` until the returned function is called. */
export function onInterrupt(cleanup: Cleanup): () => void {
    cleanups.add(cleanup);
    return () => {
        cleanups.delete(cleanup);
    };
}

/** Runs every registered cleanup, newest first, so processes die before their directories go. */
export function runInterruptCleanups(): void {
    const pending = [...cleanups].reverse();
    cleanups.clear();
    for (const cleanup of pending) {
        try {
            cleanup();
        } catch {
            // Best effort: one failure must not stop the others.
        }
    }
}

type InterruptSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

/** The signals that stop cliprobe and how a shell reports each: 128 plus its number. */
export const INTERRUPT_SIGNALS: ReadonlyMap<InterruptSignal, number> = new Map([
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143],
]);

/** The part of `process` the handlers use, so tests can pass a stand-in. */
export interface SignalTarget {
    pid: number;
    once(signal: NodeJS.Signals, listener: () => void): unknown;
    removeAllListeners(signal: NodeJS.Signals): unknown;
    kill(pid: number, signal: NodeJS.Signals): unknown;
    exit(code: number): unknown;
}

/**
 * On SIGINT, SIGTERM or SIGHUP: cleans up, then dies by the same signal, so the
 * shell or CI runner sees 130, 143 or 129 as for any other program.
 */
export function handleInterrupts(target: SignalTarget = process): void {
    const signals = [...INTERRUPT_SIGNALS.keys()];
    for (const [signal, code] of INTERRUPT_SIGNALS) {
        target.once(signal, () => {
            runInterruptCleanups();
            // Without a listener, Node restores the default action, so the signal
            // sent again ends the process the way it was asked to end.
            for (const s of signals) target.removeAllListeners(s);
            try {
                target.kill(target.pid, signal);
            } catch {
                target.exit(code);
            }
        });
    }
}
