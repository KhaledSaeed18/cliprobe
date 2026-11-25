import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { judgeRestore } from '../src/checks/restore.ts';
import type { PtyResult } from '../src/core/pty.ts';
import { cliprobe, fixture, probeJson, runCheck } from './helpers/cli.ts';

const ESC = String.fromCharCode(0x1b);

const node = process.execPath;
const hasPython = ((): boolean => {
    try {
        execFileSync('python3', ['-c', '0'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();
const only = { checks: ['restore'] };

interface RestoreJson {
    verdict: string;
    reason: string;
    evidence?: string;
    details: {
        interrupted: boolean;
        openModes: { label: string; sequence: string; line: number }[];
        settingsOff?: string[] | null;
    };
}

async function probe(command: readonly string[]): Promise<RestoreJson[]> {
    const { report } = await probeJson(command, only);
    return report.results as unknown as RestoreJson[];
}

const restoreFixture = (name: string): string[] => [node, fixture(`restore/${name}`)];

describe('restore: terminal settings (#35)', () => {
    it('warns when a program leaves the terminal in raw mode', async () => {
        const [result] = await probe(restoreFixture('raw-killed'));
        expect(result?.verdict).toBe('warn');
        expect(result?.reason).toMatch(
            /^left the terminal in raw mode \(.*icanon.*echo.* off\) after Ctrl-C; `stty sane` undoes it$/
        );
        expect(result?.details.settingsOff).toEqual(expect.arrayContaining(['icanon', 'echo']));
        expect(result?.evidence).toMatch(/^stty settings never restored: -icanon /);
    });

    it('warns for one setting left off, without calling it raw mode', async () => {
        const [result] = await probe(['sh', '-c', 'stty -echo']);
        expect(result?.verdict).toBe('warn');
        expect(result?.reason).toBe(
            'left the terminal with echo off (-echo) when it exited; `stty sane` undoes it'
        );
        expect(result?.details.settingsOff).toEqual(['echo']);
    });

    it('names modes and settings together', () => {
        const r: PtyResult = {
            output: `${ESC}[?25l`,
            exitCode: 0,
            timedOut: false,
            scriptStderr: '',
            truncated: false,
            settingsOff: ['echo'],
        };
        expect(judgeRestore(r)).toEqual({
            verdict: 'warn',
            reason: 'left the terminal with hidden cursor and with echo off (-echo) when it exited; `stty sane` undoes it',
            evidence: `${ESC}[?25l on line 1, never undone; stty settings never restored: -echo`,
        });
    });

    it.each(['spinner-restores', 'raw-key-restores', 'plain'])(
        'reports no settings left off for %s',
        async (name) => {
            const [result] = await probe(restoreFixture(name));
            expect(result?.verdict).toBe('pass');
            expect(result?.reason).toBe(
                "left no terminal mode switched on and the terminal's settings as it found them after Ctrl-C"
            );
            expect(result?.details.settingsOff).toEqual([]);
        }
    );

    it.skipIf(!hasPython)('warns for the Python program from the issue', async () => {
        const script =
            'import tty,sys,os\ntty.setraw(0)\nprint("raw now\\r", flush=True)\nwhile os.read(0,1) != b"\\x03": pass\nos._exit(130)';
        const [result] = await probe(['python3', '-c', script]);
        expect(result?.verdict).toBe('warn');
        expect(result?.details.settingsOff).toEqual(
            expect.arrayContaining(['icanon', 'echo', 'opost'])
        );
    });
});

describe('restore: fixtures', () => {
    it.each([
        [
            'spinner-restores',
            'pass',
            /left no terminal mode switched on and the terminal's settings as it found them after Ctrl-C/,
        ],
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
            `${ESC}[?1049h on line 1, never undone; ${ESC}[?1000;1006h on line 1, never undone`
        );
        expect(result?.details.interrupted).toBe(true);
        expect(result?.details.openModes.map((m) => m.label)).toEqual([
            'alternate screen',
            'mouse reporting',
        ]);
    });

    it('says when a program exited before Ctrl-C', async () => {
        const [result] = await probe(restoreFixture('exits-hidden'));
        expect(result?.details.interrupted).toBe(false);
    });
});

describe('restore: real tools', () => {
    it('passes --version and --help of node without Ctrl-C', async () => {
        const results = await probe([node]);
        expect(results.map((r) => [r.verdict, r.details.interrupted])).toEqual([
            ['pass', false],
            ['pass', false],
        ]);
    });

    it('passes sleep, stopped by Ctrl-C', async () => {
        const [result] = await probe(['sleep', '10']);
        expect(result?.verdict).toBe('pass');
        expect(result?.details.interrupted).toBe(true);
    });

    it('reports a missing command as an error, not a pass', async () => {
        const results = await runCheck('restore', ['cliprobe-no-such-command-xyz']);
        expect(results.map((r) => [r.verdict, r.reason])).toEqual([
            ['error', 'could not start: command not found'],
            ['error', 'could not start: command not found'],
        ]);
    });

    it('prints the warning in the human report', async () => {
        const r = await cliprobe(['--check', 'restore', '--', ...restoreFixture('spinner-leaks')]);
        expect(r.stdout).toMatch(
            /WARN .*spinner-leaks.*\n +left the terminal with hidden cursor after Ctrl-C\n/
        );
        expect(r.stdout).toContain('\\x1b[?25l on line 1, never undone');
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
