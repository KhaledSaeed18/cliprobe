import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    handleInterrupts,
    INTERRUPT_SIGNALS,
    onInterrupt,
    runInterruptCleanups,
    type SignalTarget,
} from '../src/core/interrupt.ts';
import { ptySupport, runPty } from '../src/core/pty.ts';
import { run } from '../src/core/run.ts';
import { BIN, cliprobe, first, probeJson, running } from './helpers/cli.ts';

const node = process.execPath;

describe('interrupt cleanups', () => {
    afterEach(runInterruptCleanups);

    it('runs the newest first, once, and goes on after one throws', () => {
        const order: string[] = [];
        onInterrupt(() => order.push('fixture'));
        onInterrupt(() => {
            throw new Error('boom');
        });
        onInterrupt(() => order.push('run'));
        const unregister = onInterrupt(() => order.push('finished'));
        unregister();
        runInterruptCleanups();
        runInterruptCleanups();
        expect(order).toEqual(['run', 'fixture']);
    });

    class FakeProcess extends EventEmitter implements SignalTarget {
        pid = 4242;
        killed: [number, string][] = [];
        exitCode: number | undefined;
        failKill = false;
        kill(pid: number, signal: NodeJS.Signals): true {
            if (this.failKill) throw new Error('EPERM');
            this.killed.push([pid, signal]);
            return true;
        }
        exit(code: number): void {
            this.exitCode = code;
        }
    }

    it.each([...INTERRUPT_SIGNALS.keys()])(
        'on %s, cleans up, then dies by the same signal',
        (signal) => {
            const target = new FakeProcess();
            let cleaned = false;
            onInterrupt(() => {
                cleaned = true;
            });
            handleInterrupts(target);
            target.emit(signal);
            expect(cleaned).toBe(true);
            // No listener is left, so the signal sent again takes the default action.
            for (const s of INTERRUPT_SIGNALS.keys()) expect(target.listenerCount(s)).toBe(0);
            expect(target.killed).toEqual([[4242, signal]]);
        }
    );

    it('exits with 128 plus the signal number if it cannot signal itself', () => {
        const target = new FakeProcess();
        target.failKill = true;
        handleInterrupts(target);
        target.emit('SIGTERM');
        expect(target.exitCode).toBe(143);
    });
});

describe('a run interrupted in this process', () => {
    const sleeping = (n: number) => (): boolean =>
        running((line) => line === `sleep ${n}`).length > 0;

    it('kills the program and resolves at once', async () => {
        const pending = run('sleep', ['77'], { timeout: 20_000 });
        await until(sleeping(77));
        runInterruptCleanups();
        const r = await pending;
        expect(r.signal).toBe('SIGKILL');
        expect(r.timedOut).toBe(false);
        expect(sleeping(77)()).toBe(false);
    });

    it.skipIf(!ptySupport().ok)('kills a program under a pseudo-terminal', async () => {
        const pending = runPty('sh', ['-c', 'trap "" HUP; sleep 78'], { timeout: 20_000 });
        await until(sleeping(78));
        runInterruptCleanups();
        await pending;
        expect(sleeping(78)()).toBe(false);
    });

    it('removes the {fixture} directory while the checks run', async () => {
        const pending = cliprobe(['--check', 'stdin', '--', 'sh', '-c', 'ls {fixture}; sleep 79']);
        await until(sleeping(79));
        runInterruptCleanups();
        const r = await pending;
        expect(r.stdout).toContain('{fixture}');
        expect(sleeping(79)()).toBe(false);
    });
});

/** Polls until `ready()` holds, for up to 10 s. */
async function until(ready: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!ready()) {
        if (Date.now() > deadline) throw new Error('timed out waiting');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/**
 * Starts the built cliprobe as its own process group with its own TMPDIR, waits
 * for `sleep <n>` to run under it, signals it, and returns how it ended and what
 * it left: processes and temporary directories.
 */
async function interrupt(
    signal: NodeJS.Signals,
    to: 'group' | 'process',
    n: number,
    args: readonly string[]
): Promise<{ signal: NodeJS.Signals | null; left: string[]; dirs: string[] }> {
    const temp = mkdtempSync(join(tmpdir(), 'cliprobe-signal-test-'));
    const isSleep = (line: string): boolean => line === `sleep ${n}`;
    try {
        const child = spawn(node, [BIN, ...args], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, TMPDIR: temp },
        });
        const exited = new Promise<NodeJS.Signals | null>((resolve) => {
            child.once('exit', (_, s) => resolve(s));
        });
        await until(() => running(isSleep).length > 0);
        const pid = child.pid ?? 0;
        process.kill(to === 'group' ? -pid : pid, signal);
        const ended = await exited;
        return { signal: ended, left: running(isSleep), dirs: readdirSync(temp) };
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}

describe('the built cliprobe, interrupted', () => {
    it.each([
        ['SIGINT', 'group'],
        ['SIGTERM', 'process'],
        ['SIGHUP', 'process'],
    ] as const)(
        'on %s to its %s, stops the probe, removes its temp dirs and dies by it',
        async (signal, to) => {
            const r = await interrupt(signal, to, 71, ['--check', 'stdin', '--', 'sleep', '71']);
            expect(r).toEqual({ signal, left: [], dirs: [] });
        }
    );

    it('removes the {fixture} directory of hostile names too', async () => {
        const r = await interrupt('SIGTERM', 'process', 73, [
            '--check',
            'control-chars',
            '--',
            'sh',
            '-c',
            'ls {fixture}; sleep 73',
        ]);
        expect(r).toEqual({ signal: 'SIGTERM', left: [], dirs: [] });
    });

    it('still dies by Ctrl-C while its report waits for a FIFO that nobody reads', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cliprobe-fifo-test-'));
        try {
            const fifo = join(dir, 'report.fifo');
            execFileSync('mkfifo', [fifo]);
            const isSleep = (line: string): boolean => line === 'sleep 0.76';
            const child = spawn(
                node,
                [BIN, '-o', fifo, '--check', 'closed-pipe', '--', 'sleep', '0.76'],
                { detached: true, stdio: 'ignore' }
            );
            const exited = new Promise<NodeJS.Signals | null>((resolve) => {
                child.once('exit', (_, s) => resolve(s));
            });
            await until(() => running(isSleep).length > 0);
            await until(() => running(isSleep).length === 0);
            // Now waiting to open the FIFO: the signal must still end it, and the FIFO stay one.
            await new Promise((resolve) => setTimeout(resolve, 500));
            process.kill(-(child.pid ?? 0), 'SIGINT');
            expect(await exited).toBe('SIGINT');
            expect(lstatSync(fifo).isFIFO()).toBe(true);
            expect(readdirSync(dir)).toEqual(['report.fifo']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it.skipIf(!ptySupport().ok)(
        'stops a program under a pseudo-terminal that ignores SIGINT and SIGHUP',
        async () => {
            for (const [signal, to] of [
                ['SIGINT', 'group'],
                ['SIGTERM', 'process'],
            ] as const) {
                const r = await interrupt(signal, to, 72, [
                    '--check',
                    'restore',
                    '--',
                    'sh',
                    '-c',
                    'trap "" INT HUP; sleep 72',
                ]);
                expect(r).toEqual({ signal, left: [], dirs: [] });
            }
        }
    );
});

describe('cliprobe probing itself', () => {
    it('passes ctrl-c and sigterm, and leaves nothing running', async () => {
        const { report } = await probeJson([node, BIN, '--check', 'stdin', '--', 'sleep', '74'], {
            checks: ['ctrl-c', 'sigterm'],
        });
        expect(report.results.map((r) => [r.check, r.verdict])).toEqual([
            ['ctrl-c', 'pass'],
            ['sigterm', 'pass'],
        ]);
        expect(first(report).reason).toMatch(/stopped by SIGINT/);
        expect(running((line) => line === 'sleep 74')).toEqual([]);
    });
});
