import { describe, expect, it } from 'vitest';
import { median } from '../src/checks/startup.ts';
import { cliprobe, first, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['startup'], timeout: 10_000 };

interface StartupJson {
    verdict: string;
    reason: string;
    invocation: string[];
    runsMs: number[];
    medianMs: number | null;
}

const probe = (command: readonly string[]): StartupJson =>
    first(probeJson(command, only).report) as unknown as StartupJson;

const slow = [node, fixture('startup/slow-version'), '--version'];

describe('median', () => {
    it('takes the middle value, or the mean of the middle two', () => {
        expect(median([5, 1, 3])).toBe(3);
        expect(median([4, 1, 3, 2])).toBe(3);
    });
});

describe('startup', () => {
    it('reports the median of 5 timed --version runs as info', () => {
        const r = probe(slow);
        expect(r.verdict).toBe('info');
        expect(r.invocation).toEqual(slow);
        expect(r.runsMs).toHaveLength(5);
        expect(r.medianMs).toBeGreaterThanOrEqual(150);
        expect(r.medianMs).toBeLessThan(2000);
        expect(r.reason).toMatch(/^median \d+ ms over 5 runs \(min \d+, max \d+\)$/);
    });

    it('times "<command> --version" when no probe args are given', () => {
        expect(probe([node]).invocation).toEqual([node, '--version']);
    });

    it('skips when --version fails', () => {
        const r = probe([node, fixture('startup/version-fails'), '--version']);
        expect(r.verdict).toBe('skip');
        expect(r.reason).toContain('exited 1');
    });

    it('reports a missing command as could-not-run, with exit 2', () => {
        const { status, report } = probeJson(['cliprobe-no-such-command-xyz'], only);
        expect(first(report).verdict).toBe('error');
        expect(status).toBe(2);
    });

    it('never fails, so the exit code stays 0', () => {
        expect(probeJson(slow, only).status).toBe(0);
    });

    it('does not run unless named', () => {
        const r = cliprobe(['--json', '--', 'printf', 'x']);
        expect((JSON.parse(r.stdout) as { checks: string[] }).checks).not.toContain('startup');
    });

    it('counts info results in the human summary', () => {
        const r = cliprobe(['--check', 'startup', '--', ...slow]);
        expect(r.stdout).toMatch(/INFO .*median \d+ ms/);
        expect(r.stdout).toMatch(/, 1 info$/m);
    });
});
