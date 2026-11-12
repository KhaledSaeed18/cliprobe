import { describe, expect, it } from 'vitest';
import { judgeRestore } from '../src/checks/restore.ts';
import type { PtyResult } from '../src/core/pty.ts';
import { cliprobe, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['restore'] };

interface RestoreJson {
    verdict: string;
    reason: string;
    evidence?: string;
    interrupted: boolean;
    openModes: { label: string; sequence: string; line: number }[];
}

async function probe(command: readonly string[]): Promise<RestoreJson[]> {
    const { report } = await probeJson(command, only);
    return report.results as unknown as RestoreJson[];
}

const restoreFixture = (name: string): string[] => [node, fixture(`restore/${name}`)];

describe('restore: fixtures', () => {
    it.each([
        ['spinner-restores', 'pass', /left no terminal mode switched on after Ctrl-C/],
        ['fullscreen-restores', 'pass', /after Ctrl-C/],
        ['raw-key-restores', 'pass', /after Ctrl-C/],
        ['resets', 'pass', /after Ctrl-C/],
        ['plain', 'pass', /after Ctrl-C/],
        ['spinner-leaks', 'warn', /^left the terminal with hidden cursor after Ctrl-C$/],
        [
            'fullscreen-leaks',
            'warn',
            /^left the terminal with alternate screen and mouse reporting after Ctrl-C$/,
        ],
        ['raw-key-leaks', 'warn', /alternate screen and hidden cursor after Ctrl-C/],
        ['exits-hidden', 'warn', /^left the terminal with hidden cursor when it exited$/],
        ['ignores', 'skip', /still running 3 s after Ctrl-C/],
    ])('%s -> %s', async (name, verdict, reason) => {
        const [result] = await probe(restoreFixture(name));
        expect(result?.verdict).toBe(verdict);
        expect(result?.reason).toMatch(reason);
    });

    it('quotes each sequence that was never undone, with its line', async () => {
        const [result] = await probe(restoreFixture('fullscreen-leaks'));
        expect(result?.evidence).toBe(
            'ESC[?1049h on line 1, never undone; ESC[?1000;1006h on line 1, never undone'
        );
        expect(result?.interrupted).toBe(true);
        expect(result?.openModes.map((m) => m.label)).toEqual([
            'alternate screen',
            'mouse reporting',
        ]);
    });

    it('says when a program exited before Ctrl-C', async () => {
        const [result] = await probe(restoreFixture('exits-hidden'));
        expect(result?.interrupted).toBe(false);
    });
});

describe('restore: real tools', () => {
    it('passes --version and --help of node without Ctrl-C', async () => {
        const results = await probe([node]);
        expect(results.map((r) => [r.verdict, r.interrupted])).toEqual([
            ['pass', false],
            ['pass', false],
        ]);
    });

    it('passes sleep, stopped by Ctrl-C', async () => {
        const [result] = await probe(['sleep', '10']);
        expect(result?.verdict).toBe('pass');
        expect(result?.interrupted).toBe(true);
    });

    it('reports a missing command as an error, not a pass', async () => {
        const results = await probe(['cliprobe-no-such-command-xyz']);
        expect(results.map((r) => [r.verdict, r.reason])).toEqual([
            ['error', 'could not start: command not found'],
            ['error', 'could not start: command not found'],
        ]);
    });

    it('prints the warning in the human report', async () => {
        const r = await cliprobe(['--check', 'restore', '--', ...restoreFixture('spinner-leaks')]);
        expect(r.stdout).toMatch(/restore.*left the terminal with hidden cursor after Ctrl-C/);
        expect(r.stdout).toContain('ESC[?25l on line 1, never undone');
    });
});

describe('judgeRestore', () => {
    const base: PtyResult = {
        output: '',
        exitCode: 0,
        timedOut: false,
        scriptStderr: '',
        truncated: false,
    };

    it('reports a spawn error', () => {
        expect(
            judgeRestore({ ...base, exitCode: null, spawnError: 'spawn script ENOENT' })
        ).toEqual({
            verdict: 'error',
            reason: 'could not start: spawn script ENOENT',
        });
    });

    it('skips a program that waited for input and never finished', () => {
        expect(judgeRestore({ ...base, timedOut: true }).reason).toBe(
            'waited for input in a terminal, so it never finished'
        );
    });

    it('skips output cut off at the cap, whose end is missing', () => {
        const j = judgeRestore({ ...base, output: '\x1b[?25l', truncated: true });
        expect(j.verdict).toBe('skip');
        expect(j.reason).toMatch(/more than 1 MiB/);
    });
});
