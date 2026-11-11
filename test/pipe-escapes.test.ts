import { describe, expect, it } from 'vitest';
import { first, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['pipe-escapes'] };

interface PipeEscapesJson {
    verdict: string;
    reason: string;
    evidence?: string;
    stdoutKinds: string[];
    stderrKinds: string[];
}

const probe = (command: readonly string[]): { status: number | null; result: PipeEscapesJson } => {
    const { status, report } = probeJson(command, only);
    return { status, result: first(report) as unknown as PipeEscapesJson };
};
const escFixture = (name: string): string[] => [node, fixture(`pipe-escapes/${name}`)];

describe('pipe-escapes: fixtures', () => {
    it.each([
        ['spinner', 'warn', /carriage-return redraw and line or screen erase/],
        ['cursor-hide', 'warn', /terminal mode switch/],
        ['hyperlink', 'warn', /hyperlink \(OSC 8\)/],
        ['title', 'warn', /window title/],
        ['tty-spinner', 'pass', /no cursor, erase/],
        ['crlf', 'pass', /no cursor, erase/],
        ['color-only', 'pass', /no cursor, erase/],
    ])('%s -> %s', (name, verdict, reason) => {
        const { result } = probe(escFixture(name));
        expect(result.verdict).toBe(verdict);
        expect(result.reason).toMatch(reason);
    });

    it('skips a program that prints nothing', () => {
        expect(probe([node, fixture('color/empty')]).result.verdict).toBe('skip');
    });

    it('checks stderr too, where spinners usually draw, and says which stream', () => {
        const { result } = probe(escFixture('spinner'));
        expect(result.stdoutKinds).toEqual([]);
        expect(result.stderrKinds).toEqual(['redraw', 'erase']);
        expect(result.evidence).toMatch(/^stderr line 1: /);
    });

    it('warns without failing, so the exit code stays 0', () => {
        expect(probe(escFixture('hyperlink')).status).toBe(0);
    });

    it('reports a missing command as could-not-run', () => {
        expect(probe(['cliprobe-no-such-command-xyz']).result.verdict).toBe('error');
    });
});

describe('pipe-escapes: real tools pass', () => {
    it.each([
        ['printf', ['printf', 'hello\\n']],
        ['ls', ['ls', '.']],
        ['node --version', [node, '--version']],
    ])('%s', (_name, command) => {
        expect(probe(command).result.verdict).toBe('pass');
    });
});
