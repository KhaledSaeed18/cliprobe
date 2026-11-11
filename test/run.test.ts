import { describe, expect, it } from 'vitest';
import { run } from '../src/core/run.ts';
import { fixture } from './helpers/cli.ts';

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

    it('calls beforeKill on timeout', async () => {
        let called = false;
        const r = await run(node, [fixture('hang-always')], {
            timeout: 300,
            beforeKill: () => {
                called = true;
            },
        });
        expect(r.timedOut).toBe(true);
        expect(r.signal).toBe('SIGKILL');
        expect(called).toBe(true);
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
