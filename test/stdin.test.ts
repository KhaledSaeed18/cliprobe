import { describe, expect, it } from 'vitest';
import { judgeStdin, type StdinRuns } from '../src/checks/stdin.ts';
import type { RunResult } from '../src/core/run.ts';
import { first, fixture, probeJson, runCheck } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['stdin'], timeout: 5000 };

interface StdinJson {
    verdict: string;
    reason: string;
    evidence?: string;
    invocation: string[];
    details: {
        waitedForStdin: boolean;
        finishedAfterCloseMs: number | null;
    };
}

async function results(
    command: readonly string[]
): Promise<{ status: number | null; results: StdinJson[] }> {
    const { status, report } = await probeJson(command, only);
    return { status, results: report.results as unknown as StdinJson[] };
}
const one = async (command: readonly string[]): Promise<StdinJson> =>
    first((await probeJson(command, only)).report) as unknown as StdinJson;

describe("stdin: cliprobe's own --version and --help probes", () => {
    it('fails a program that waits for stdin before answering, with the timings as evidence', async () => {
        const { status, results: rs } = await results([fixture('stdin/help-waits')]);
        expect(status).toBe(1);
        expect(rs.map((r) => r.invocation.at(-1))).toEqual(['--version', '--help']);
        for (const r of rs) {
            expect(r.verdict).toBe('fail');
            expect(r.reason).toMatch(/waited for stdin before answering/);
            expect(r.evidence).toMatch(
                /with stdin closed; still running after 3 s with stdin open; finished \d+ ms after stdin closed/
            );
            expect(r.details.waitedForStdin).toBe(true);
            expect(r.details.finishedAfterCloseMs).toBeLessThan(1500);
        }
    });

    it('passes a program that takes 3 to 4 s to answer but never reads stdin', async () => {
        const { status, results: rs } = await results([fixture('stdin/slow-answer')]);
        expect(status).toBe(0);
        expect(rs.map((r) => r.verdict)).toEqual(['pass', 'pass']);
    });

    it('passes a program that answers --version and --help without reading stdin', async () => {
        const { status, results: rs } = await results([fixture('stdin/filter-cli')]);
        expect(status).toBe(0);
        expect(rs.map((r) => r.verdict)).toEqual(['pass', 'pass']);
    });
});

describe('stdin: probes the user wrote', () => {
    it.each([
        ['filter-cli', 'skip', /reads stdin like a filter/],
        ['prompts', 'warn', /seems to prompt for input/],
        ['spinner-wait', 'skip', /reads stdin like a filter/],
        ['tty-guarded', 'pass', /finished without waiting/],
        ['hangs', 'skip', /doesn't finish even with stdin closed/],
        ['pipe-hang', 'skip', /closing stdin didn't end it/],
    ])('%s -> %s', async (name, verdict, reason) => {
        const r = await one([node, fixture(`stdin/${name}`)]);
        expect(r.verdict).toBe(verdict);
        expect(r.reason).toMatch(reason);
    });

    it('quotes the prompt as evidence', async () => {
        expect((await one([node, fixture('stdin/prompts')])).evidence).toMatch(
            /^prompt: Proceed\? \(y\/n\) ; /
        );
    });

    it('never fails a probe the user wrote, and warns without failing', async () => {
        expect((await results([node, fixture('stdin/prompts')])).status).toBe(0);
    });

    it('reports a missing command as could-not-run', async () => {
        const [result] = await runCheck('stdin', ['cliprobe-no-such-command-xyz']);
        expect(result?.verdict).toBe('error');
    });
});

describe('stdin: real tools', () => {
    it.each([
        ['printf', ['printf', 'hello\\n'], 'pass'],
        ['node --version', [node, '--version'], 'pass'],
        ['cat as a filter', ['cat', '-'], 'skip'],
        ['grep as a filter', ['grep', 'needle'], 'skip'],
    ])('%s -> %s', async (_name, command, verdict) => {
        expect((await one(command)).verdict).toBe(verdict);
    });

    it("passes cat and grep on cliprobe's own --version and --help probes", async () => {
        for (const tool of ['cat', 'grep']) {
            expect((await results([tool])).results.map((r) => r.verdict)).toEqual(['pass', 'pass']);
        }
    });
});

describe('stdin: slow programs', () => {
    it('still proves a slow program waits for stdin, with windows scaled to its time', async () => {
        const [result] = await runCheck('stdin', [node, fixture('stdin/slow-reader')], 6000);
        expect(result).toMatchObject({ verdict: 'skip', waitedForStdin: true });
        expect(result?.reason).toMatch(/reads stdin like a filter/);
        expect(result?.evidence).toMatch(/still running after 4(\.\d)? s with stdin open/);
    });
});

describe('judgeStdin', () => {
    const ran = (durationMs: number, timedOut = false): RunResult => ({
        stdoutBytes: 0,
        stdout: Buffer.alloc(0),
        stderr: '',
        timedOut,
        exitCode: timedOut ? null : 0,
        signal: timedOut ? 'SIGKILL' : null,
        durationMs,
    });

    it('skips when --timeout leaves too little room to tell a slow program from a waiting one', () => {
        const runs: StdinRuns = { closed: ran(2500), open: ran(5000, true), openMs: 5000 };
        expect(judgeStdin(runs, true)).toMatchObject({
            verdict: 'skip',
            reason: expect.stringMatching(
                /takes 2500 ms even with stdin closed.*raise --timeout/
            ) as unknown,
        });
    });

    it('does not blame stdin when the confirming run finished before the close', () => {
        const runs: StdinRuns = {
            closed: ran(100),
            open: ran(3000, true),
            openMs: 3000,
            closing: ran(400),
            closeAfterMs: 1200,
        };
        expect(judgeStdin(runs, true)).toMatchObject({
            verdict: 'skip',
            reason: expect.stringMatching(/finished before stdin was closed/) as unknown,
        });
    });

    it('fails a default probe that finished only after the close, quoting the scaled times', () => {
        const runs: StdinRuns = {
            closed: ran(1500),
            open: ran(4000, true),
            openMs: 4000,
            closing: ran(4100),
            closeAfterMs: 4000,
        };
        expect(judgeStdin(runs, true)).toMatchObject({
            verdict: 'fail',
            evidence:
                '1500 ms with stdin closed; still running after 4 s with stdin open; finished 100 ms after stdin closed',
        });
    });
});
