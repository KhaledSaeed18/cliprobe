import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { cleanPtyOutput, ptyArgs, ptySupport, runPty, shellQuote } from '../src/core/pty.ts';
import { fixture } from './helpers/cli.ts';

const node = process.execPath;

interface TtyReport {
    stdin: boolean;
    stdout: boolean;
    stderr: boolean;
    cols: number | null;
    rows: number | null;
    TERM: string | null;
    NO_COLOR: string | null;
    CI: string | null;
}

const firstLine = (output: string): string => output.split('\n')[0] ?? '';

/** True once the process is gone or a zombie waiting to be reaped. */
async function isDead(pid: number): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
        let stat = '';
        try {
            stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
        } catch {
            return true; // ps exits non-zero when there is no such process
        }
        if (stat.trim().startsWith('Z')) return true;
        await sleep(50);
    }
    return false;
}

describe('ptyArgs', () => {
    it('passes argv straight through on BSD', () => {
        const args = ptyArgs('bsd', '/t/pid', 'cmd', ['a b', "it's"]);
        expect(args.slice(0, 4)).toEqual(['-q', '/dev/null', '/bin/sh', '-c']);
        expect(args.slice(5)).toEqual(['sh', '/t/pid', 'cmd', 'a b', "it's"]);
    });

    it('builds one quoted line with -e on util-linux', () => {
        const args = ptyArgs('util-linux', '/t/pid', 'cmd', ["it's"]);
        expect(args[0]).toBe('-qec');
        expect(args[2]).toBe('/dev/null');
        expect(args[1]).toMatch(/^exec \/bin\/sh -c '.*' sh '\/t\/pid' 'cmd' 'it'\\''s'$/);
    });

    it('sets the window size', () => {
        expect(ptyArgs('bsd', 'p', 'c', [], 100, 30).join(' ')).toContain('stty cols 100 rows 30');
    });

    it('quotes for a POSIX shell', () => {
        expect(shellQuote("a'b")).toBe("'a'\\''b'");
        expect(shellQuote('')).toBe("''");
    });
});

describe('cleanPtyOutput', () => {
    it('strips the BSD EOF echo and turns CRLF back into LF', () => {
        expect(cleanPtyOutput(Buffer.from('^D\b\ba\r\nb\r\n'), 'bsd')).toBe('a\nb\n');
    });

    it('leaves a leading ^D alone on util-linux, which never adds one', () => {
        expect(cleanPtyOutput(Buffer.from('^D\b\bx'), 'util-linux')).toBe('^D\b\bx');
    });
});

describe('runPty', () => {
    it('is supported on this machine', () => {
        expect(ptySupport()).toMatchObject({ ok: true });
    });

    it('gives the program a terminal on all three streams, 80x24, TERM=xterm-256color', async () => {
        const r = await runPty(node, [fixture('tty-report')], { timeout: 10_000 });
        const report = JSON.parse(firstLine(r.output)) as TtyReport;
        expect(report).toMatchObject({ stdin: true, stdout: true, stderr: true });
        expect(report).toMatchObject({ cols: 80, rows: 24, TERM: 'xterm-256color' });
    });

    it('applies env overrides', async () => {
        const r = await runPty(node, [fixture('tty-report')], {
            timeout: 10_000,
            env: { NO_COLOR: '1', CI: undefined },
        });
        const report = JSON.parse(firstLine(r.output)) as TtyReport;
        expect(report.NO_COLOR).toBe('1');
        expect(report.CI).toBeNull();
    });

    it('merges stderr into the output, as a terminal does', async () => {
        const r = await runPty(node, [fixture('tty-report')], { timeout: 10_000 });
        expect(r.output).toContain('to stderr\n');
    });

    it("reports the program's exit code", async () => {
        const r = await runPty(node, [fixture('tty-report'), '7'], { timeout: 10_000 });
        expect(r.exitCode).toBe(7);
        expect(r.timedOut).toBe(false);
    });

    it('returns exactly what the program printed, with no EOF echo or CR', async () => {
        for (let i = 0; i < 20; i++) {
            const r = await runPty('printf', ['abc\\ndef\\n'], { timeout: 10_000 });
            expect(r.output).toBe('abc\ndef\n');
        }
    });

    it('delivers awkward arguments unchanged', async () => {
        const args = ["it's", '$HOME', '`id`', '"q"', 'a  b', '', '-n', '\\n', ';exit 3', 'ünï'];
        const r = await runPty(node, [fixture('argv'), ...args], { timeout: 10_000 });
        expect(JSON.parse(firstLine(r.output))).toEqual(args);
        expect(r.exitCode).toBe(0);
    });

    it('keeps large output intact', async () => {
        const r = await runPty(
            '/bin/sh',
            ['-c', 'i=0; while [ $i -lt 2000 ]; do echo "line $i"; i=$((i+1)); done'],
            {
                timeout: 10_000,
            }
        );
        const lines = r.output.trimEnd().split('\n');
        expect(lines).toHaveLength(2000);
        expect(lines.at(-1)).toBe('line 1999');
    });

    it('gives a program that reads stdin one EOF', async () => {
        const r = await runPty('cat', [], { timeout: 10_000 });
        expect(r.timedOut).toBe(false);
        expect(r.exitCode).toBe(0);
        expect(r.output).toBe('');
    });

    it('times out a program that reads stdin a second time', async () => {
        const r = await runPty('/bin/sh', ['-c', 'read a; echo "first=$?"; read b'], {
            timeout: 1500,
        });
        expect(r.timedOut).toBe(true);
        expect(r.output).toBe('first=1\n');
    });

    it('kills a program that ignores SIGHUP on timeout, leaving no orphan', async () => {
        const r = await runPty(node, [fixture('stubborn')], { timeout: 1500 });
        expect(r.timedOut).toBe(true);
        const pid = Number(/pid (\d+)/.exec(r.output)?.[1]);
        expect(pid).toBeGreaterThan(1);
        expect(await isDead(pid)).toBe(true);
    });

    it('returns a non-zero exit for a missing command instead of throwing', async () => {
        const r = await runPty('/no/such/command', [], { timeout: 10_000 });
        expect(r.exitCode).not.toBe(0);
    });
});
