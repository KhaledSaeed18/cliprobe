import { describe, expect, it } from 'vitest';
import { first, fixture, probeJson, runCheck } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['stdin'], timeout: 5000 };

interface StdinJson {
    verdict: string;
    reason: string;
    evidence?: string;
    invocation: string[];
    waitedForStdin: boolean;
    finishedAfterCloseMs: number | null;
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
            expect(r.waitedForStdin).toBe(true);
            expect(r.finishedAfterCloseMs).toBeLessThan(1500);
        }
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
