import { describe, expect, it } from 'vitest';
import { UNKNOWN_FLAG } from '../src/checks/baseline.ts';
import { cliprobe, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['baseline'], timeout: 10_000 };

interface BaselineJson {
    verdict: string;
    reason: string;
    evidence?: string;
    invocation: string[];
    exitCode: number | null;
}

function probe(name: string): BaselineJson[] {
    const { report } = probeJson([node, fixture(`baseline/${name}`)], only);
    return report.results as unknown as BaselineJson[];
}

describe('baseline', () => {
    it('appends --version, --help and an unknown flag to the probe args', () => {
        const results = probe('conventional');
        expect(results.map((r) => r.invocation.at(-1))).toEqual([
            '--version',
            '--help',
            UNKNOWN_FLAG,
        ]);
        expect(results.every((r) => r.invocation[1] === fixture('baseline/conventional'))).toBe(
            true
        );
    });

    it('describes a conventional program, as info', () => {
        const [version, help, unknown] = probe('conventional');
        expect(version).toMatchObject({
            verdict: 'info',
            reason: 'printed one line to stdout',
            evidence: '1.2.3',
        });
        expect(help).toMatchObject({
            verdict: 'info',
            reason: 'printed 3 lines to stdout and exited 0',
        });
        expect(unknown).toMatchObject({
            verdict: 'info',
            reason: 'exited 2 with its message on stderr',
        });
        expect(unknown?.evidence).toContain('unknown option');
    });

    it('describes each broken convention', () => {
        const [version, help, unknown] = probe('unconventional');
        expect(version?.reason).toMatch(/printed 2 lines to stdout/);
        expect(help?.reason).toMatch(/printed help to stderr and exited 1/);
        expect(unknown?.reason).toMatch(/exited 0, so a script cannot tell the flag was wrong/);
    });

    it('stops a program that ignores the unknown flag after 5 s', () => {
        const [, , unknown] = probe('default-action');
        expect(unknown?.reason).toMatch(/still running after 5 s/);
    });

    it('never fails, so the exit code stays 0', () => {
        expect(probeJson([node, fixture('baseline/unconventional')], only).status).toBe(0);
    });

    it('probes the command itself when no args are given', () => {
        const { report } = probeJson(['printf'], only);
        expect(report.results.map((r) => r.invocation)).toEqual([
            ['printf', '--version'],
            ['printf', '--help'],
            ['printf', UNKNOWN_FLAG],
        ]);
    });

    it('is not run unless named', () => {
        const r = cliprobe(['--json', '--', 'printf', 'x']);
        expect((JSON.parse(r.stdout) as { checks: string[] }).checks).not.toContain('baseline');
    });

    it('reports a missing command as could-not-run, with exit 2', () => {
        const { status, report } = probeJson(['cliprobe-no-such-command-xyz'], only);
        expect(report.results.every((r) => r.verdict === 'error')).toBe(true);
        expect(status).toBe(2);
    });
});
