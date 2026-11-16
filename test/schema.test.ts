import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECKS } from '../src/checks/index.ts';
import { SCHEMA_VERSION } from '../src/report/json.ts';
import { assertValidReport, first, probeJson, SCHEMA, undeclared } from './helpers/cli.ts';

const node = process.execPath;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    files: string[];
    exports: Record<string, string>;
};

describe('schema.json', () => {
    it('names every check, in registry order, and describes the details of each', () => {
        const names = CHECKS.map((c) => c.name);
        expect(SCHEMA.$defs['checkName']).toEqual({ enum: names });
        for (const name of names) expect(SCHEMA.$defs[`details.${name}`]).toBeDefined();
    });

    it('carries the schema version the report writes', () => {
        expect(
            (SCHEMA['properties'] as Record<string, { const?: number }>)['schemaVersion']
        ).toEqual({ const: SCHEMA_VERSION });
    });

    it('ships in the package, importable as cliprobe/schema.json', () => {
        expect(pkg.files).toContain('schema.json');
        expect(pkg.exports['./schema.json']).toBe('./schema.json');
    });
});

describe('JSON report', () => {
    it('validates for every check at once, with a summary that matches the results', async () => {
        const all = { checks: CHECKS.map((c) => c.name) };
        const { report } = await probeJson([node], all);
        expect(report.schemaVersion).toBe(1);
        expect(report.checks).toEqual(all.checks);
        const counts: Record<string, number> = {
            pass: 0,
            fail: 0,
            warn: 0,
            skip: 0,
            error: 0,
            info: 0,
        };
        for (const r of report.results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
        expect(report.summary).toEqual(counts);
    });

    it('keeps the shared fields at the top and leaves out evidence when there is none', async () => {
        const { report } = await probeJson([node], { checks: ['stdin'] });
        expect(Object.keys(first(report))).toEqual([
            'check',
            'invocation',
            'verdict',
            'reason',
            'details',
        ]);
    });

    it('rejects a report that breaks the schema or has a field it does not declare', () => {
        const report = {
            tool: 'cliprobe',
            schemaVersion: 1,
            version: '1.0.0',
            command: 'x',
            checks: ['startup'],
            summary: { pass: 0, fail: 0, warn: 0, skip: 0, error: 0, info: 1 },
            results: [
                {
                    check: 'startup',
                    invocation: ['x', '--version'],
                    verdict: 'info',
                    reason: 'median 5 ms',
                    details: { runsMs: [5], medianMs: 5 },
                },
            ],
        };
        expect(() => assertValidReport(report)).not.toThrow();
        expect(() => assertValidReport({ ...report, schemaVersion: 2 })).toThrow(/schema\.json/);
        const extra = structuredClone(report);
        Object.assign(extra.results[0]?.details ?? {}, { surprise: true });
        expect(() => assertValidReport(extra)).toThrow(/\$\.results\[0\]\.details\.surprise/);
    });

    it('walks arrays and references when looking for undeclared fields', () => {
        const schema = { properties: { a: { items: { $ref: '#/$defs/result' } } } };
        expect(undeclared({ a: [{ check: 'x', extra: 1 }] }, schema)).toEqual(['$.a[0].extra']);
    });
});
