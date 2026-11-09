import { describe, expect, it } from 'vitest';
import { cliprobe, fixture, probeJson } from './helpers/cli.ts';

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
        expect(report.results.every((r) => r.verdict === 'error')).toBe(true);
    });

    it('probes --version and --help when given no args', () => {
        const { report } = probeJson(['node']);
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
});
