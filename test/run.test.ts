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
