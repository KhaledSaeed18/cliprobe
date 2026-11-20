import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { run } from '../src/core/run.ts';
import { endsWith, fixture, running } from './helpers/cli.ts';

const node = process.execPath;

describe('run', () => {
    it('captures stdout', async () => {
        const r = await run('printf', ['a\\nb\\n'], { timeout: 5000 });
        expect(r.stdout.toString()).toBe('a\nb\n');
        expect(r.stdoutBytes).toBe(4);
        expect(r.exitCode).toBe(0);
    });

    it('caps captured stdout at 1 MiB but counts every byte', async () => {
        const r = await run(node, [fixture('big')], { timeout: 10_000 });
        expect(r.stdoutBytes).toBe(2 * 1024 * 1024);
        expect(r.stdout.length).toBe(1024 * 1024);
    });

    it('applies env overrides and removes variables set to undefined', async () => {
        const r = await run(node, [fixture('env')], {
            timeout: 5000,
            env: { TERM: 'xterm-256color', CI: undefined, EXTRA: 'yes' },
        });
        const env = JSON.parse(r.stdout.toString()) as Record<string, string>;
        expect(env['TERM']).toBe('xterm-256color');
        expect(env['EXTRA']).toBe('yes');
        expect(env).not.toHaveProperty('CI');
        expect(env['HOME']).toMatch(/cliprobe-/);
    });

    it("starts from the minimal environment, without the caller's variables", async () => {
        process.env['CLIPROBE_TEST_SECRET'] = 'leaked';
        try {
            const r = await run(node, [fixture('env')], { timeout: 5000 });
            const env = JSON.parse(r.stdout.toString()) as Record<string, string>;
            expect(env['TERM']).toBe('dumb');
            expect(env['CI']).toBe('1');
            expect(env).not.toHaveProperty('CLIPROBE_TEST_SECRET');
        } finally {
            delete process.env['CLIPROBE_TEST_SECRET'];
        }
    });

    it('kills the extra process group on timeout, as under a pseudo-terminal', async () => {
        const other = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
        await new Promise((resolve) => other.once('spawn', resolve));
        const gone = new Promise((resolve) => other.once('exit', (_, signal) => resolve(signal)));
        const r = await run(node, [fixture('hang-always')], {
            timeout: 300,
            extraGroup: () => other.pid,
        });
        expect(r.timedOut).toBe(true);
        expect(r.signal).toBe('SIGKILL');
        expect(await gone).toBe('SIGKILL');
    });
});

describe('run with a delayed signal', () => {
    it('sends the signal to a running program and marks where stderr was', async () => {
        const r = await run(node, [fixture('sigint-130')], {
            timeout: 5000,
            signal: { name: 'SIGINT', afterMs: 300 },
        });
        expect(r.exitCode).toBe(130);
        expect(r.signalSentMs).toBeGreaterThanOrEqual(300);
        expect(r.stderr.slice(0, r.stderrAtSignal)).toBe('before\n');
        expect(r.stderr.slice(r.stderrAtSignal)).toBe('after\n');
        expect(r.durationMs).toBeGreaterThanOrEqual(r.signalSentMs ?? 0);
    });

    it('does not send it to a program that already exited', async () => {
        const r = await run('printf', ['x'], {
            timeout: 5000,
            signal: { name: 'SIGINT', afterMs: 300 },
        });
        expect(r.exitCode).toBe(0);
        expect(r.signalSentMs).toBeUndefined();
        expect(r.durationMs).toBeLessThan(300);
    });
});

describe('run with a stdin mode', () => {
    it('gives /dev/null by default, so a reader sees the end at once', async () => {
        const r = await run(node, [fixture('stdin-read')], { timeout: 5000 });
        expect(r.stdout.toString()).toBe('read 0 bytes\n');
        expect(r.durationMs).toBeLessThan(1000);
    });

    it('leaves an open pipe open, so a reader waits until the timeout', async () => {
        const r = await run(node, [fixture('stdin-read')], { timeout: 800, stdin: 'open' });
        expect(r.timedOut).toBe(true);
        expect(r.stdout.toString()).toBe('');
    });

    it('closes the pipe after a delay, and the reader finishes just after', async () => {
        const r = await run(node, [fixture('stdin-read')], {
            timeout: 5000,
            stdin: { closeAfterMs: 500 },
        });
        expect(r.timedOut).toBe(false);
        expect(r.stdout.toString()).toBe('read 0 bytes\n');
        expect(r.durationMs).toBeGreaterThanOrEqual(500);
        expect(r.durationMs).toBeLessThan(2500);
    });

    it('does not let an open pipe keep a finished program from being reported', async () => {
        const r = await run('printf', ['x'], { timeout: 5000, stdin: 'open' });
        expect(r.timedOut).toBe(false);
        expect(r.exitCode).toBe(0);
    });
});

describe('run after the program exits', () => {
    it('kills what it left running, in its group and in a session of its own', async () => {
        const r = await run(node, [fixture('leaves-children')], { timeout: 10_000 });
        expect(r.timedOut).toBe(false);
        expect(r.exitCode).toBe(0);
        expect(r.leftRunning?.map((m) => m.command.split(' // ')[1]).sort()).toEqual([
            'run-detached',
            'run-orphan',
        ]);
        expect(running(endsWith('run-orphan'))).toEqual([]);
        expect(running(endsWith('run-detached'))).toEqual([]);
    });

    it('returns at the exit, not when a child that holds stdout is killed at the timeout', async () => {
        const r = await run(node, [fixture('holds-stdout')], { timeout: 10_000 });
        expect(r.timedOut).toBe(false);
        expect(r.stdout.toString()).toBe('parent done\n');
        expect(r.durationMs).toBeLessThan(2000);
        expect(r.leftRunning).toHaveLength(1);
        expect(running(endsWith('holds-stdout'))).toEqual([]);
    });

    it('lets a quick background job finish and keeps its output', async () => {
        const r = await run('sh', ['-c', '(sleep 0.05; echo late) & echo early'], {
            timeout: 5000,
        });
        expect(r.stdout.toString()).toBe('early\nlate\n');
        expect(r.leftRunning).toEqual([]);
    });

    it('leaves no timer behind, so cliprobe exits as soon as it reports', async () => {
        const timers = (): number =>
            process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
        const before = timers();
        // The pipes close only once the child is killed, after the exit: the slow path.
        for (let i = 0; i < 3; i++) await run(node, [fixture('holds-stdout')], { timeout: 5000 });
        // A timer of an earlier test may end meanwhile; a leak adds one per run.
        expect(timers()).toBeLessThanOrEqual(before);
    });
});
