import { describe, expect, it } from 'vitest';
import { BIN, first, fixture, probeJson, ROOT } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['closed-pipe'] };

describe('closed-pipe', () => {
    it('fails a raw process.stdout.write that crashes', async () => {
        const { status, report } = await probeJson([node, fixture('crash')], only);
        expect(status).toBe(1);
        expect(first(report).verdict).toBe('fail');
        expect(first(report).evidence).toMatch(/EPIPE|Unhandled 'error'/);
    });

    it('passes console.log, because console swallows stream errors', async () => {
        const { status, report } = await probeJson([node, fixture('clean')], only);
        expect(status).toBe(0);
        expect(first(report).verdict).toBe('pass');
    });

    it('passes a program that handles EPIPE', async () => {
        const { report } = await probeJson([node, fixture('handled')], only);
        expect(first(report).verdict).toBe('pass');
    });

    it('passes a fast native program stopped by SIGPIPE, deterministically', async () => {
        for (let i = 0; i < 10; i++) {
            const { report } = await probeJson(['printf', 'hello\\n'], only);
            expect(first(report).verdict).toBe('pass');
            expect(first(report).closed.signal).toBe('SIGPIPE');
        }
    });

    it('skips a program that writes nothing to stdout', async () => {
        const { status, report } = await probeJson([node, fixture('silent')], only);
        expect(status).toBe(0);
        expect(first(report).verdict).toBe('skip');
    });

    it('fails a program that hangs only after stdout closes', async () => {
        const { status, report } = await probeJson([node, fixture('hang')], only);
        expect(status).toBe(1);
        expect(first(report).verdict).toBe('fail');
        expect(first(report).closed.timedOut).toBe(true);
    });

    it('passes cliprobe itself', async () => {
        const { report } = await probeJson([node, BIN, '--help'], only);
        expect(first(report).verdict).toBe('pass');
    });

    it("resolves a relative command path from the caller's directory", async () => {
        const { report } = await probeJson(['./test/fixtures/run-crash.sh'], {
            ...only,
            cwd: ROOT,
        });
        expect(first(report).verdict).toBe('fail');
    });

    it("resolves relative arguments from the caller's directory", async () => {
        const { report } = await probeJson(['node', './test/fixtures/crash.mjs'], {
            ...only,
            cwd: ROOT,
        });
        expect(first(report).verdict).toBe('fail');
    });
});
