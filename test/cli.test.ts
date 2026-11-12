import { describe, expect, it } from 'vitest';
import { cliprobe, fixture, probeJson, type Report } from './helpers/cli.ts';

describe('cli', () => {
    it('escapes control characters from the target in human output', async () => {
        const r = await cliprobe(['--timeout', '3000', '--', process.execPath, fixture('ctrl')]);
        expect(r.status).toBe(1);
        expect(r.stdout, 'raw OSC escape leaked to the terminal').not.toContain('\u001b]0;');
        expect(r.stdout).toMatch(/\\x1b\]0;pwned\\x07/);
    });

    it('reports a missing command as could-not-run with exit 2', async () => {
        const { status, report } = await probeJson(['cliprobe-no-such-command-xyz']);
        expect(status).toBe(2);
        expect(report.checks).toEqual([
            'closed-pipe',
            'color',
            'pipe-escapes',
            'stdin',
            'ctrl-c',
            'restore',
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
            'restore:error',
            'stdin:error',
        ]);
    });

    it('exits 2 for a missing command even with {fixture}, when every check errors', async () => {
        const { status, report } = await probeJson(['cliprobe-no-such-command-xyz', '{fixture}']);
        expect(status).toBe(2);
        expect(report.results.every((r) => r.verdict === 'error')).toBe(true);
    });

    it('lines up evidence under the reason when {fixture} is in the args', async () => {
        const r = await cliprobe([
            '--check',
            'control-chars',
            '--',
            process.execPath,
            fixture('control-chars/raw'),
            '{fixture}',
        ]);
        const lines = r.stdout.split('\n');
        const row = lines.findIndex((l) => l.startsWith('  FAIL'));
        const reasonAt = lines[row]!.indexOf('sent escape');
        expect(lines[row + 1]!.search(/\S/)).toBe(reasonAt);
        expect(r.stdout).not.toMatch(/cliprobe-fixture-/);
    });

    it('probes --version and --help when given no args', async () => {
        const { report } = await probeJson(['node'], { checks: ['closed-pipe'] });
        expect(report.results.map((r) => r.invocation.slice(1))).toEqual([
            ['--version'],
            ['--help'],
        ]);
    });

    it('exits 2 on usage errors', async () => {
        expect((await cliprobe([])).status).toBe(2);
        expect((await cliprobe(['--bogus'])).status).toBe(2);
        expect((await cliprobe(['--timeout', 'abc', '--', 'node'])).status).toBe(2);
    });

    it('survives its own closed stdout', async () => {
        const r = await cliprobe(['--json', '--', process.execPath, fixture('clean')]);
        expect(r.status).toBe(0);
    });

    it('runs only the checks named with --check and lists them in JSON', async () => {
        const r = await cliprobe(['--json', '--check', 'closed-pipe', '--', 'printf', 'hi\\n']);
        expect(r.status).toBe(0);
        const report = JSON.parse(r.stdout) as Report;
        expect(report.checks).toEqual(['closed-pipe']);
        expect(report.results.map((x) => x.check)).toEqual(['closed-pipe']);
    });

    it('exits 2 on an unknown check and names the available ones', async () => {
        const r = await cliprobe(['--check', 'colour', '--', 'node']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('unknown check "colour"');
        expect(r.stderr).toContain('available: closed-pipe');
        expect(r.stdout).toBe('');
    });

    it('lists --check in --help', async () => {
        expect((await cliprobe(['--help'])).stdout).toContain('--check <name>');
    });

    it('prints the same JSON for --format json as for --json', async () => {
        const a = await cliprobe([
            '--format',
            'json',
            '--check',
            'closed-pipe',
            '--',
            'printf',
            'x',
        ]);
        const b = await cliprobe(['--json', '--check', 'closed-pipe', '--', 'printf', 'x']);
        expect(a.status).toBe(0);
        expect(JSON.parse(a.stdout)).toEqual(JSON.parse(b.stdout));
    });

    it('exits 2 on an unknown --format before running anything', async () => {
        const r = await cliprobe(['--format', 'xml', '--', 'printf', 'x']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('--format needs one of human, json, markdown, junit');
        expect(r.stdout).toBe('');
    });
});
