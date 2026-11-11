import { describe, expect, it } from 'vitest';
import { cliprobe, fixture, probeJson, type Report } from './helpers/cli.ts';

describe('cli', () => {
    it('escapes control characters from the target in human output', () => {
        const r = cliprobe(['--timeout', '3000', '--', process.execPath, fixture('ctrl')]);
        expect(r.status).toBe(1);
        expect(r.stdout, 'raw OSC escape leaked to the terminal').not.toContain('\u001b]0;');
        expect(r.stdout).toMatch(/\\x1b\]0;pwned\\x07/);
    });

    it('reports a missing command as could-not-run with exit 2', () => {
        const { status, report } = probeJson(['cliprobe-no-such-command-xyz']);
        expect(status).toBe(2);
        expect(report.checks).toEqual([
            'closed-pipe',
            'color',
            'pipe-escapes',
            'ctrl-c',
            'control-chars',
        ]);
        // Every check that runs the program says it could not; control-chars, with no
        // {fixture} to plant, skips without running it.
        const verdicts = new Set(report.results.map((r) => `${r.check}:${r.verdict}`));
        expect([...verdicts].sort()).toEqual([
            'closed-pipe:error',
            'color:error',
            'control-chars:skip',
            'ctrl-c:skip',
            'pipe-escapes:error',
        ]);
    });

    it('exits 2 for a missing command even with {fixture}, when every check errors', () => {
        const { status, report } = probeJson(['cliprobe-no-such-command-xyz', '{fixture}']);
        expect(status).toBe(2);
        expect(report.results.every((r) => r.verdict === 'error')).toBe(true);
    });

    it('probes --version and --help when given no args', () => {
        const { report } = probeJson(['node'], { checks: ['closed-pipe'] });
        expect(report.results.map((r) => r.invocation.slice(1))).toEqual([
            ['--version'],
            ['--help'],
        ]);
    });

    it('exits 2 on usage errors', () => {
        expect(cliprobe([]).status).toBe(2);
        expect(cliprobe(['--bogus']).status).toBe(2);
        expect(cliprobe(['--timeout', 'abc', '--', 'node']).status).toBe(2);
    });

    it('survives its own closed stdout', () => {
        const r = cliprobe(['--json', '--', process.execPath, fixture('clean')]);
        expect(r.status).toBe(0);
    });

    it('runs only the checks named with --check and lists them in JSON', () => {
        const r = cliprobe(['--json', '--check', 'closed-pipe', '--', 'printf', 'hi\\n']);
        expect(r.status).toBe(0);
        const report = JSON.parse(r.stdout) as Report;
        expect(report.checks).toEqual(['closed-pipe']);
        expect(report.results.map((x) => x.check)).toEqual(['closed-pipe']);
    });

    it('exits 2 on an unknown check and names the available ones', () => {
        const r = cliprobe(['--check', 'colour', '--', 'node']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('unknown check "colour"');
        expect(r.stderr).toContain('available: closed-pipe');
        expect(r.stdout).toBe('');
    });

    it('lists --check in --help', () => {
        expect(cliprobe(['--help']).stdout).toContain('--check <name>');
    });

    it('prints the same JSON for --format json as for --json', () => {
        const a = cliprobe(['--format', 'json', '--check', 'closed-pipe', '--', 'printf', 'x']);
        const b = cliprobe(['--json', '--check', 'closed-pipe', '--', 'printf', 'x']);
        expect(a.status).toBe(0);
        expect(JSON.parse(a.stdout)).toEqual(JSON.parse(b.stdout));
    });

    it('exits 2 on an unknown --format before running anything', () => {
        const r = cliprobe(['--format', 'xml', '--', 'printf', 'x']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('--format needs one of human, json, markdown, junit');
        expect(r.stdout).toBe('');
    });
});
