import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { cliprobe, first, fixture, probeJson, runCheck } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['ctrl-c'] };

interface CtrlCJson {
    verdict: string;
    reason: string;
    evidence?: string;
    sentAfterMs: number | null;
    exitedAfterMs: number | null;
    exitCode: number | null;
    signal: string | null;
}

async function probe(
    command: readonly string[]
): Promise<{ status: number | null; result: CtrlCJson }> {
    const { status, report } = await probeJson(command, only);
    return { status, result: first(report) as unknown as CtrlCJson };
}

const ctrlFixture = (name: string): string[] => [node, fixture(`ctrl-c/${name}`)];

describe('ctrl-c: fixtures', () => {
    it.each([
        ['default', 'pass', /stopped by SIGINT/],
        ['exit-130', 'pass', /exited with 130/],
        ['re-raise', 'pass', /stopped by SIGINT/],
        ['exit-1', 'pass', /exited with code 1 .*130 is the convention/],
        ['trace-before', 'pass', /exited with 130/],
        ['exit-0', 'warn', /exited 0 after Ctrl-C/],
        ['ignores', 'fail', /ignored Ctrl-C: still running 3 s later/],
        ['throws', 'fail', /stack trace/],
        ['python-trace', 'fail', /stack trace/],
        ['quick', 'skip', /finished in \d+ ms, before Ctrl-C/],
    ])('%s -> %s', async (name, verdict, reason) => {
        const { result } = await probe(ctrlFixture(name));
        expect(result.verdict).toBe(verdict);
        expect(result.reason).toMatch(reason);
    });

    it('quotes the error and the frame in the program as evidence', async () => {
        expect((await probe(ctrlFixture('throws'))).result.evidence).toMatch(
            /^Error: interrupted \(at .*throws\.mjs:\d+:\d+\)$/
        );
        expect((await probe(ctrlFixture('python-trace'))).result.evidence).toBe(
            'KeyboardInterrupt'
        );
    });

    it('records when Ctrl-C was sent and how long the exit took', async () => {
        const { result } = await probe(ctrlFixture('slow'));
        expect(result.verdict).toBe('pass');
        expect(result.sentAfterMs).toBeGreaterThanOrEqual(1000);
        expect(result.exitedAfterMs).toBeGreaterThanOrEqual(1400);
        expect(result.exitedAfterMs).toBeLessThan(3000);
        expect(result.exitCode).toBe(130);
    });

    it('leaves no process behind after a program that ignores Ctrl-C', async () => {
        const [, script] = ctrlFixture('ignores');
        // Only processes that are the fixture itself, not shells that mention its path.
        const running = (): string[] =>
            execFileSync('ps', ['-axo', 'args='], { encoding: 'utf8' })
                .split('\n')
                .filter((line) => line.startsWith(`${node} ${script}`));
        await probe(ctrlFixture('ignores'));
        expect(running()).toEqual([]);
    });

    it('exits 1 when it fails', async () => {
        expect((await probe(ctrlFixture('ignores'))).status).toBe(1);
    });

    it('reports a missing command as could-not-run', async () => {
        const [result] = await runCheck('ctrl-c', ['cliprobe-no-such-command-xyz', 'watch']);
        expect(result?.verdict).toBe('error');
    });

    it('skips once, without running anything, when there are no probe args', async () => {
        const { report } = await probeJson([node], only);
        expect(report.results).toHaveLength(1);
        expect(first(report)).toMatchObject({ verdict: 'skip', invocation: [node] });
        expect(first(report).reason).toMatch(/keep it running/);
    });

    it('shows the reason in human output', async () => {
        const r = await cliprobe(['--check', 'ctrl-c', '--', ...ctrlFixture('ignores')]);
        expect(r.stdout).toMatch(/FAIL .*ignored Ctrl-C/);
    });
});

describe('ctrl-c: real tools', () => {
    it.each([
        ['sleep', ['sleep', '30']],
        ['tail -f', ['tail', '-f', '/dev/null']],
        ['node with a timer', [node, '-e', 'setInterval(() => {}, 1000)']],
    ])('%s passes', async (_name, command) => {
        expect((await probe(command)).result.verdict).toBe('pass');
    });

    const hasPython = (() => {
        try {
            execFileSync('python3', ['--version'], { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    })();

    it.skipIf(!hasPython)(
        'python3 sleeping fails with its KeyboardInterrupt traceback',
        async () => {
            const { result } = await probe(['python3', '-c', 'import time; time.sleep(30)']);
            expect(result.verdict).toBe('fail');
            expect(result.evidence).toBe('KeyboardInterrupt');
        }
    );
});
