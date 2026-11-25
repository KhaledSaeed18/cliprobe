import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { exitCodeFor } from '../src/cli/program.ts';
import type { Result, Verdict } from '../src/core/types.ts';
import { formatJunit } from '../src/report/junit.ts';
import { formatMarkdown } from '../src/report/markdown.ts';
import type { Report } from '../src/report/types.ts';
import { cliprobe, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const exitZero = [node, fixture('ctrl-c/exit-0')];
const result = (verdict: Verdict): Result => ({
    check: 'ctrl-c',
    invocation: ['tool', 'serve'],
    verdict,
    reason: `reason for ${verdict}`,
});
const report = (results: Result[], strict: boolean): Report => ({
    version: '9.9.9',
    command: 'tool',
    checks: ['ctrl-c'],
    strict,
    results,
});

describe('exitCodeFor', () => {
    it('exits 1 on a warning only with strict', () => {
        const warned = [result('pass'), result('warn')];
        expect(exitCodeFor(warned)).toBe(0);
        expect(exitCodeFor(warned, true)).toBe(1);
    });

    it('keeps 0 for passes, skips and info, and 2 when nothing could run, even with strict', () => {
        expect(exitCodeFor([result('pass'), result('skip'), result('info')], true)).toBe(0);
        expect(exitCodeFor([result('error')], true)).toBe(2);
    });
});

describe('--strict', () => {
    it('turns a warning into exit 1 and says why', async () => {
        const plain = await cliprobe(['--check', 'ctrl-c', '--', ...exitZero]);
        expect(plain.status).toBe(0);
        expect(plain.stdout).toMatch(/1 warned, 0 passed, 0 skipped\n$/);
        const strict = await cliprobe(['--strict', '--check', 'ctrl-c', '--', ...exitZero]);
        expect(strict.status).toBe(1);
        expect(strict.stdout).toMatch(/WARN .*(?:\n +)?.*exited 0 after Ctrl-C/);
        expect(strict.stdout).toMatch(/\(--strict: warnings fail\)\n$/);
    });

    it('records strict in the JSON report', async () => {
        const plain = await probeJson(exitZero, { checks: ['ctrl-c'] });
        expect(plain.report).toMatchObject({ strict: false, summary: { warn: 1 } });
        const r = await cliprobe(['--json', '--strict', '--check', 'ctrl-c', '--', ...exitZero]);
        expect(r.status).toBe(1);
        expect(JSON.parse(r.stdout)).toMatchObject({ strict: true });
    });

    it('makes a warning a JUnit failure, counted as one', () => {
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
        const parse = (
            strict: boolean
        ): { failures: string; testsuite: { testcase: { failure?: { type: string } } } } =>
            (
                parser.parse(formatJunit(report([result('warn')], strict))) as {
                    testsuites: {
                        failures: string;
                        testsuite: { testcase: { failure?: { type: string } } };
                    };
                }
            ).testsuites;
        expect(parse(false).failures).toBe('0');
        expect(parse(false).testsuite.testcase.failure).toBeUndefined();
        expect(parse(true).failures).toBe('1');
        expect(parse(true).testsuite.testcase.failure?.type).toBe('warn');
    });

    it('bolds warnings in Markdown, as it bolds failures', () => {
        const md = (strict: boolean): string => formatMarkdown(report([result('warn')], strict));
        expect(md(false)).toContain('| WARN |');
        expect(md(true)).toContain('| **WARN** |');
        expect(md(true)).toContain('(--strict: warnings fail)');
    });
});

describe('--skip', () => {
    it('leaves a check out of the run', async () => {
        const { report: r } = await probeJson([node], { checks: [] });
        const all = r.checks;
        const skipped = await cliprobe(['--json', '--skip', 'restore,control-chars', '--', node]);
        const report2 = JSON.parse(skipped.stdout) as { checks: string[] };
        expect(report2.checks).toEqual(all.filter((c) => c !== 'restore' && c !== 'control-chars'));
    });

    it('rejects an unknown name, and a skip that leaves nothing to run', async () => {
        const unknown = await cliprobe(['--skip', 'colour', '--', node]);
        expect(unknown.status).toBe(2);
        expect(unknown.stderr).toMatch(/unknown check "colour"/);
        const none = await cliprobe(['--check', 'color', '--skip', 'color', '--', node]);
        expect(none.status).toBe(2);
        expect(none.stderr).toMatch(/--skip leaves no check to run/);
    });
});
