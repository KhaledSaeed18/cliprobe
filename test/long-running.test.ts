import { describe, expect, it } from 'vitest';
import { cliprobe, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const long = (name: string): string[] => [node, fixture(`long-running/${name}`)];
const verdicts = (report: { results: { check: string; verdict: string }[] }): string[] =>
    report.results.map((r) => `${r.check}:${r.verdict}`);
const checks = ['closed-pipe', 'color', 'pipe-escapes', 'stdin'];
const probe = (name: string) => probeJson(long(name), { checks, timeout: 1500 });

describe('long-running probes: judged on what they did before the timeout', () => {
    it('warns on a server that crashes once its stdout is closed', async () => {
        const { status, report } = await probe('logger');
        expect(verdicts(report)).toEqual([
            'closed-pipe:warn',
            'color:skip',
            'pipe-escapes:pass',
            'stdin:skip',
        ]);
        expect(report.results[0]?.reason).toMatch(/while a normal run kept running/);
        expect(report.results[0]?.evidence).toMatch(/EPIPE/);
        expect(report.results[1]?.reason).toMatch(/^still running after \d+ s with no color/);
        expect(report.results[3]?.reason).toMatch(/keeps running even with stdin closed/);
        expect(status).toBe(0);
    });

    it('passes a server that ignores the closed stdout and keeps running', async () => {
        const { status, report } = await probe('quiet-server');
        expect(verdicts(report)).toEqual([
            'closed-pipe:pass',
            'color:skip',
            'pipe-escapes:pass',
            'stdin:skip',
        ]);
        expect(report.results[0]?.reason).toMatch(/kept running without a write error/);
        expect(status).toBe(0);
    });

    it('fails color that a watcher prints into a pipe', async () => {
        const { report } = await probe('color-logger');
        expect(report.results.find((r) => r.check === 'color')?.verdict).toBe('fail');
    });

    it('warns on a spinner a dev server draws into a pipe', async () => {
        const { report } = await probe('spinner-server');
        const escapes = report.results.find((r) => r.check === 'pipe-escapes');
        expect(escapes?.verdict).toBe('warn');
        expect(escapes?.evidence).toMatch(/^stderr line 1: /);
    });

    it('skips a program that never prints, with no error', async () => {
        const { status, report } = await probe('silent');
        expect(verdicts(report)).toEqual([
            'closed-pipe:skip',
            'color:skip',
            'pipe-escapes:skip',
            'stdin:skip',
        ]);
        expect(report.results[2]?.reason).toMatch(/printed nothing so far/);
        expect(status).toBe(0);
    });

    it('fails a watcher that prints file names raw, judged before the timeout', async () => {
        const { report } = await probeJson([...long('watch-lister'), '{fixture}'], {
            checks: ['control-chars'],
            timeout: 1500,
        });
        expect(report.results[0]?.verdict).toBe('fail');
    });

    it('skips a long-running program that never printed the file names', async () => {
        const { report } = await probeJson([...long('silent'), '{fixture}'], {
            checks: ['control-chars'],
            timeout: 1500,
        });
        expect(report.results[0]?.verdict).toBe('skip');
        expect(report.results[0]?.reason).toMatch(/still running in a terminal at the timeout/);
    });

    it('pays the timeout once, not once per check', async () => {
        const start = performance.now();
        const r = await cliprobe([
            '--timeout',
            '4000',
            '--check',
            checks.join(','),
            '--',
            ...long('quiet-server'),
        ]);
        // 4 s for the first run, then a 3 s window each for the closed-stdout,
        // color and pipe-escapes runs; stdin runs nothing. Before, it was 4 s x 5.
        expect(performance.now() - start).toBeLessThan(15_000);
        expect(r.stdout).not.toMatch(/ERROR/);
    });
});
