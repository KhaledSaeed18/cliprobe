import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import type { Result } from '../src/core/types.ts';
import { formatJunit, xml } from '../src/report/junit.ts';
import type { Report } from '../src/report/types.ts';
import { cliprobe, fixture } from './helpers/cli.ts';

const ESC = String.fromCharCode(0x1b);
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['testsuite', 'testcase'].includes(name),
});

interface Case {
    classname: string;
    name: string;
    failure?: { message: string; '#text'?: string };
    error?: { message: string };
    skipped?: { message: string };
    'system-out'?: string;
}
interface Parsed {
    testsuites: {
        tests: string;
        failures: string;
        errors: string;
        skipped: string;
        testsuite: { name: string; tests: string; testcase: Case[] }[];
    };
}

const result = (verdict: Result['verdict'], extra: Partial<Result> = {}): Result => ({
    check: 'closed-pipe',
    invocation: ['tool', '--version'],
    verdict,
    reason: `reason for ${verdict}`,
    ...extra,
});

const report = (results: Result[]): Report => ({
    version: '9.9.9',
    command: 'tool',
    checks: [...new Set(results.map((r) => r.check))],
    results,
});

function parse(text: string): Parsed {
    expect(XMLValidator.validate(text)).toBe(true);
    return parser.parse(text) as Parsed;
}

describe('xml escaping', () => {
    it('escapes the five markup characters', () => {
        expect(xml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
    });

    it('turns control characters, which XML 1.0 forbids, into visible escapes', () => {
        expect(xml(`a${ESC}[2Jb\u0000c`)).toBe('a\\x1b[2Jb\\x00c');
    });
});

describe('formatJunit', () => {
    it('maps verdicts onto JUnit outcomes, with counts per suite and overall', () => {
        const results = [
            result('fail', { evidence: 'Error: write EPIPE' }),
            result('error'),
            result('skip'),
            result('warn', { evidence: 'stdout line 1' }),
            result('pass'),
            result('info', { check: 'startup' }),
        ];
        const doc = parse(formatJunit(report(results)));
        expect(doc.testsuites).toMatchObject({
            tests: '6',
            failures: '1',
            errors: '1',
            skipped: '1',
        });
        const [pipe, startup] = doc.testsuites.testsuite;
        expect(pipe).toMatchObject({ name: 'closed-pipe', tests: '5' });
        expect(startup).toMatchObject({ name: 'startup', tests: '1' });
        const cases = pipe?.testcase ?? [];
        expect(cases[0]?.failure).toMatchObject({
            message: 'reason for fail',
            '#text': 'Error: write EPIPE',
        });
        expect(cases[1]?.error).toMatchObject({ message: 'reason for error' });
        expect(cases[2]?.skipped).toMatchObject({ message: 'reason for skip' });
        expect(cases[3]?.['system-out']).toBe('WARN: reason for warn\nstdout line 1');
        expect(cases[4]?.['system-out']).toBe('PASS: reason for pass');
        expect(startup?.testcase[0]?.['system-out']).toBe('INFO: reason for info');
        expect(cases[0]).toMatchObject({
            classname: 'cliprobe.closed-pipe',
            name: 'tool --version',
        });
    });

    it('stays well-formed and keeps hostile text as text', () => {
        const hostile = result('fail', {
            invocation: ['tool', `"><evil/>`, `${ESC}]0;t\u0007`],
            reason: 'could not start: a & b <c> ]]>',
            evidence: `</failure><injected/>${ESC}[2J`,
        });
        const text = formatJunit({ ...report([hostile]), command: `tool"<x>` });
        const doc = parse(text);
        expect(text).not.toContain('<evil/>');
        expect(text).not.toContain('<injected/>');
        expect(text).not.toContain(ESC);
        const testcase = doc.testsuites.testsuite[0]?.testcase[0];
        expect(testcase?.name).toBe('tool "><evil/> \\x1b]0;t\\x07');
        expect(testcase?.failure?.message).toBe('could not start: a & b <c> ]]>');
        expect(testcase?.failure?.['#text']).toBe('</failure><injected/>\\x1b[2J');
    });

    it('is what --format junit prints, with the usual exit code', () => {
        const r = cliprobe([
            '--format',
            'junit',
            '--check',
            'closed-pipe',
            '--',
            process.execPath,
            fixture('crash'),
        ]);
        expect(r.status).toBe(1);
        const doc = parse(r.stdout);
        expect(doc.testsuites).toMatchObject({ tests: '1', failures: '1' });
        expect(doc.testsuites.testsuite[0]?.testcase[0]?.failure?.['#text']).toMatch(
            /^Error: write EPIPE/
        );
    });
});
