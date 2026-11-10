import { describe, expect, it } from 'vitest';
import { cliprobe, first, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['control-chars'] };

interface ControlCharsJson {
    verdict: string;
    reason: string;
    evidence?: string;
    terminalRaw: string[];
    pipeRaw: string[];
}

function probe(command: readonly string[]): { status: number | null; result: ControlCharsJson } {
    const { status, report } = probeJson(command, only);
    return { status, result: first(report) as unknown as ControlCharsJson };
}

const lister = (name: string): string[] => [node, fixture(`control-chars/${name}`), '{fixture}'];

/** C0 except newline, C1, DEL, separators and bidi overrides, found by code. */
function rawControls(text: string): number[] {
    const codes = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
    return codes.filter(
        (c) =>
            (c < 0x20 && c !== 0x0a) ||
            (c >= 0x7f && c <= 0x9f) ||
            c === 0x2028 ||
            c === 0x2029 ||
            (c >= 0x202a && c <= 0x202e) ||
            (c >= 0x2066 && c <= 0x2069)
    );
}

describe('control-chars: fixtures', () => {
    it.each([
        ['escaped', 'pass', /^escaped control characters in file names$/],
        ['inspect', 'pass', /escaped control characters.*bidirectional override as is/],
        ['tty-only', 'pass', /^escaped control characters in file names$/],
        ['raw', 'fail', /sent escape sequences from file names to the terminal unescaped/],
        ['json', 'warn', /a C1 control character from file names unescaped/],
        ['esc-only', 'warn', /C1 control character, a carriage return and a newline/],
        ['no-names', 'skip', /did not print the file names in \{fixture\}/],
    ])('%s -> %s', (name, verdict, reason) => {
        const { result } = probe(lister(name));
        expect(result.verdict).toBe(verdict);
        expect(result.reason).toMatch(reason);
    });

    it('lists what reached the terminal and, as data only, what reached a pipe', () => {
        expect(probe(lister('raw')).result.terminalRaw).toEqual([
            'osc',
            'csi',
            'c1',
            'cr',
            'newline',
            'bidi',
        ]);
        const ttyOnly = probe(lister('tty-only')).result;
        expect(ttyOnly.terminalRaw).toEqual([]);
        expect(ttyOnly.pipeRaw).toEqual(['osc', 'csi', 'c1', 'cr', 'newline', 'bidi']);
    });

    it('exits 1 on a fail', () => {
        expect(probe(lister('raw')).status).toBe(1);
    });

    it('skips without {fixture}, saying how to use it', () => {
        const { result } = probe([node, fixture('control-chars/raw'), '.']);
        expect(result.verdict).toBe('skip');
        expect(result.reason).toContain('ls {fixture}');
    });

    it('reports a missing command as could-not-run', () => {
        expect(probe(['cliprobe-no-such-command-xyz', '{fixture}']).result.verdict).toBe('error');
    });

    it('keeps every hostile character out of its own human and JSON output', () => {
        const human = cliprobe(['--check', 'control-chars', '--', ...lister('raw')]);
        expect(human.stdout).toContain('file names printed raw: title-\\x1b]0;cliprobe\\x07.txt');
        expect(rawControls(human.stdout)).toEqual([]);
        const json = cliprobe(['--json', '--check', 'control-chars', '--', ...lister('raw')]);
        expect(rawControls(json.stdout)).toEqual([]);
        expect(json.stdout).toContain('{fixture}');
    });
});

describe('control-chars: real tools', () => {
    it('ls escapes names on a terminal', () => {
        expect(probe(['ls', '{fixture}']).result.verdict).toBe('pass');
    });

    // GNU find escapes on a terminal; BSD find (macOS) prints names raw, a true finding.
    it(`find ${process.platform === 'darwin' ? 'fails (BSD)' : 'passes (GNU)'}`, () => {
        const expected = process.platform === 'darwin' ? 'fail' : 'pass';
        expect(probe(['find', '{fixture}']).result.verdict).toBe(expected);
    });
});
