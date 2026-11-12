import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { judgeColor } from '../src/checks/color.ts';
import type { RunResult } from '../src/core/run.ts';
import { cliprobe, first, fixture, probeJson, runCheck } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['color'] };
const colorFixture = (name: string): string => fixture(`color/${name}`);

async function verdictOf(
    name: string,
    timeout?: number
): Promise<{ verdict: string; reason: string; evidence?: string }> {
    const { report } = await probeJson([node, colorFixture(name)], {
        ...only,
        ...(timeout ? { timeout } : {}),
    });
    return first(report);
}

describe('color: fixtures', () => {
    it.each([
        ['tty-aware', 'pass', /NO_COLOR turns it off/],
        ['plain', 'pass', /no color in a pipe or in a terminal/],
        ['reset-only', 'pass', /no color in a pipe or in a terminal/],
        ['ci-forced', 'pass', /no color/],
        ['always', 'fail', /color codes into a pipe/],
        ['bold', 'fail', /color codes into a pipe/],
        ['term-only', 'fail', /color codes into a pipe/],
        ['ignores-no-color', 'warn', /ignores NO_COLOR/],
        ['stderr-always', 'warn', /stderr when it was a pipe/],
        ['empty', 'skip', /printed nothing/],
    ])('%s -> %s', async (name, verdict, reason) => {
        const result = await verdictOf(name);
        expect(result.verdict).toBe(verdict);
        expect(result.reason).toMatch(reason);
    });

    it('skips a program that waits for input in a terminal', async () => {
        const result = await verdictOf('prompts', 1500);
        expect(result.verdict).toBe('skip');
        expect(result.reason).toMatch(/waited for input/);
    });

    it('points at the colored line as evidence', async () => {
        expect((await verdictOf('always')).evidence).toBe(
            'stdout line 1: \x1b[31merror\x1b[0m: boom'
        );
        expect((await verdictOf('ignores-no-color')).evidence).toMatch(/^terminal line 1: /);
    });

    it('exits 1 on a fail and 0 on a warn', async () => {
        expect((await probeJson([node, colorFixture('always')], only)).status).toBe(1);
        expect((await probeJson([node, colorFixture('ignores-no-color')], only)).status).toBe(0);
    });

    it('escapes the evidence in human output', async () => {
        const r = await cliprobe(['--check', 'color', '--', node, colorFixture('always')]);
        expect(r.stdout).not.toContain('\x1b');
        expect(r.stdout).toContain('\\x1b[31merror');
    });

    it('records each run in JSON, and leaves out runs it did not need', async () => {
        const pass = (await probeJson([node, colorFixture('tty-aware')], only)).report.results[0];
        expect(pass).toMatchObject({
            pipe: { stdoutStyled: false, stderrStyled: false },
            tty: { styled: true, timedOut: false },
            noColor: { styled: false },
        });
        const fail = (await probeJson([node, colorFixture('always')], only)).report.results[0];
        expect(fail).toMatchObject({ pipe: { stdoutStyled: true }, tty: null, noColor: null });
    });

    it('reports a missing command as could-not-run', async () => {
        const results = await runCheck('color', ['cliprobe-no-such-command-xyz']);
        expect(results.map((r) => r.verdict)).toEqual(['error', 'error']);
    });
});

describe('color: real tools must not fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cliprobe-color-'));
    writeFileSync(join(dir, 'file.txt'), 'needle in a haystack\n');
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const lsColor = process.platform === 'darwin' ? ['ls', '-G', dir] : ['ls', '--color=auto', dir];

    it.each([
        ['printf', ['printf', 'hello\\n']],
        ['ls', lsColor],
        ['grep --color=auto', ['grep', '--color=auto', 'needle', join(dir, 'file.txt')]],
        ['node --version', [node, '--version']],
    ])('%s', async (_name, command) => {
        const result = first((await probeJson(command, only)).report);
        // Not every real tool honors NO_COLOR (a warn), but none may fail.
        expect(['pass', 'warn']).toContain(result.verdict);
    });
});

describe('judgeColor without a PTY', () => {
    const pipe = (stdout: string, stderr = ''): RunResult => ({
        stdoutBytes: stdout.length,
        stdout: Buffer.from(stdout),
        stderr,
        timedOut: false,
        exitCode: 0,
        signal: null,
        durationMs: 0,
    });

    it('still fails color in a pipe', () => {
        expect(judgeColor({ pipe: pipe('\x1b[31mx'), noPty: 'none' }).verdict).toBe('fail');
    });

    it('skips with the reason when the pipe is clean', () => {
        const j = judgeColor({ pipe: pipe('x'), noPty: 'script(1) is not the util-linux version' });
        expect(j.verdict).toBe('skip');
        expect(j.reason).toContain('util-linux');
    });
});
