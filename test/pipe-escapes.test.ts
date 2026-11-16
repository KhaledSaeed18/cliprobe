import { describe, expect, it } from 'vitest';
import { judgePipeEscapes } from '../src/checks/pipe-escapes.ts';
import type { RunResult } from '../src/core/run.ts';
import { first, fixture, probeJson, runCheck } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['pipe-escapes'] };

interface PipeEscapesJson {
    verdict: string;
    reason: string;
    evidence?: string;
    details: {
        stdoutKinds: string[];
        stderrKinds: string[];
    };
}

const probe = async (
    command: readonly string[]
): Promise<{ status: number | null; result: PipeEscapesJson }> => {
    const { status, report } = await probeJson(command, only);
    return { status, result: first(report) as unknown as PipeEscapesJson };
};
const escFixture = (name: string): string[] => [node, fixture(`pipe-escapes/${name}`)];

describe('pipe-escapes: fixtures', () => {
    it.each([
        ['spinner', 'fail', /carriage-return redraw and line or screen erase/],
        ['cursor-hide', 'fail', /terminal mode switch/],
        ['hyperlink', 'fail', /hyperlink \(OSC 8\)/],
        ['title', 'fail', /window title/],
        ['progress-meter', 'warn', /redrew lines with carriage returns/],
        ['tty-spinner', 'pass', /no cursor, erase/],
        ['crlf', 'pass', /no cursor, erase/],
        ['color-only', 'pass', /no cursor, erase/],
    ])('%s -> %s', async (name, verdict, reason) => {
        const { result } = await probe(escFixture(name));
        expect(result.verdict).toBe(verdict);
        expect(result.reason).toMatch(reason);
    });

    it('skips a program that prints nothing', async () => {
        expect((await probe([node, fixture('color/empty')])).result.verdict).toBe('skip');
    });

    it('checks stderr too, where spinners usually draw, and says which stream', async () => {
        const { result } = await probe(escFixture('spinner'));
        expect(result.details.stdoutKinds).toEqual([]);
        expect(result.details.stderrKinds).toEqual(['redraw', 'erase']);
        expect(result.evidence).toMatch(/^stderr line 1: /);
    });

    it('fails on an escape sequence, so the exit code is 1', async () => {
        expect((await probe(escFixture('hyperlink'))).status).toBe(1);
    });

    it('only warns on a carriage-return progress meter, so the exit code stays 0', async () => {
        const { status, result } = await probe(escFixture('progress-meter'));
        expect(result.details.stderrKinds).toEqual(['redraw']);
        expect(result.evidence).toMatch(/^stderr line 1: /);
        expect(status).toBe(0);
    });

    it('reports a missing command as could-not-run', async () => {
        const [result] = await runCheck('pipe-escapes', ['cliprobe-no-such-command-xyz']);
        expect(result?.verdict).toBe('error');
    });
});

describe('judgePipeEscapes', () => {
    const piped = (stdout: string, stderr = ''): RunResult => ({
        stdoutBytes: stdout.length,
        stdout: Buffer.from(stdout),
        stderr,
        timedOut: false,
        exitCode: 0,
        signal: null,
        durationMs: 0,
    });

    it('shows the escape sequence as evidence, not an earlier carriage return', () => {
        const j = judgePipeEscapes(piped('loading\rdone\n', 'ok\n\x1b[?25l'));
        expect(j.verdict).toBe('fail');
        expect(j.reason).toMatch(/carriage-return redraw and terminal mode switch/);
        expect(j.evidence).toBe('stderr line 2: \x1b[?25l');
    });

    it('fails a program still running at the timeout on what it printed so far', () => {
        const j = judgePipeEscapes({ ...piped('\x1b[2J\x1b[Hwatching\n'), timedOut: true });
        expect(j.verdict).toBe('fail');
        expect(j.reason).toMatch(/line or screen erase and cursor movement/);
    });
});

describe('pipe-escapes: {fixture} names', () => {
    it('leaves raw file names in a pipe to control-chars, so a plain lister passes', async () => {
        const { result } = await probe([node, fixture('control-chars/raw'), '{fixture}']);
        expect(result.verdict).toBe('pass');
    });

    it("still warns on the program's own control codes next to the names", async () => {
        const { result } = await probe([
            node,
            fixture('pipe-escapes/names-and-spinner'),
            '{fixture}',
        ]);
        expect(result.verdict).toBe('warn');
        expect(result.evidence).toMatch(/^stderr line 1: /);
    });

    it('passes ls {fixture}, which prints names raw into a pipe by design', async () => {
        expect((await probe(['ls', '{fixture}'])).result.verdict).toBe('pass');
    });
});

describe('pipe-escapes: real tools pass', () => {
    it.each([
        ['printf', ['printf', 'hello\\n']],
        ['ls', ['ls', '.']],
        ['node --version', [node, '--version']],
    ])('%s', async (_name, command) => {
        expect((await probe(command)).result.verdict).toBe('pass');
    });
});
