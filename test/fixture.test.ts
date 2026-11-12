import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
    collapseFixture,
    collapseResults,
    createFixture,
    expandFixture,
    HOSTILE_NAMES,
    PLAIN_NAME,
    usesFixture,
    withoutHostileNames,
} from '../src/core/fixture.ts';
import { fixture, probeJson } from './helpers/cli.ts';

describe('createFixture', () => {
    it('creates every hostile name plus a plain one, and removes them all', () => {
        const f = createFixture();
        const names = readdirSync(f.dir).sort();
        expect(names).toEqual([...HOSTILE_NAMES.map((h) => h.name), PLAIN_NAME].sort());
        f.cleanup();
        expect(existsSync(f.dir)).toBe(false);
    });

    it('gives each hostile name a marker it contains and a control or bidi character', () => {
        for (const h of HOSTILE_NAMES) {
            expect(h.name).toContain(h.marker);
            const codes = Array.from({ length: h.marker.length }, (_, i) => h.marker.charCodeAt(i));
            expect(codes.some((c) => c < 0x20 || c >= 0x7f)).toBe(true);
        }
    });
});

describe('placeholder', () => {
    it('is found and replaced anywhere in an argument', () => {
        expect(usesFixture(['ls', '--dir={fixture}'])).toBe(true);
        expect(usesFixture(['ls', 'fixture'])).toBe(false);
        expect(expandFixture(['{fixture}', '--dir={fixture}/x'], '/t')).toEqual([
            '/t',
            '--dir=/t/x',
        ]);
    });

    it('is put back over both the path and its resolved form', () => {
        const f = { dir: '/var/x', realDir: '/private/var/x', cleanup: () => {} };
        expect(collapseFixture('/var/x/f and /private/var/x/g', f)).toBe(
            '{fixture}/f and {fixture}/g'
        );
    });

    it('reaches the program as a real directory that is gone afterwards, and reports as {fixture}', async () => {
        const scratch = mkdtempSync(join(tmpdir(), 'cliprobe-test-'));
        onTestFinished(() => rmSync(scratch, { recursive: true, force: true }));
        const out = join(scratch, 'arg');
        const { report } = await probeJson(
            [process.execPath, fixture('record-arg'), '{fixture}', out],
            {
                checks: ['closed-pipe'],
            }
        );
        const seen = readFileSync(out, 'utf8');
        expect(seen).toMatch(/cliprobe-fixture-/);
        expect(existsSync(seen)).toBe(false);
        expect(report.results[0]?.invocation.slice(2)).toEqual(['{fixture}', out]);
    });
});

describe('withoutHostileNames', () => {
    it("removes each name's dangerous part and keeps the rest", () => {
        const text = HOSTILE_NAMES.map((h) => h.name).join('\n');
        const out = withoutHostileNames(text);
        for (const h of HOSTILE_NAMES) expect(out).not.toContain(h.marker);
        expect(out).toContain('title-.txt');
        expect(withoutHostileNames('plain\r')).toBe('plain\r');
    });
});

describe('collapseResults', () => {
    it('collapses the path in every string of a result, leaving other values alone', () => {
        const f = createFixture();
        onTestFinished(() => f.cleanup());
        const result = {
            check: 'control-chars',
            invocation: ['ls', f.dir],
            verdict: 'pass' as const,
            reason: 'ok',
            evidence: `in ${f.realDir}/x`,
            data: { n: 3, ok: true, none: null, list: [`${f.dir}/a`] },
        };
        const { evidence: _evidence, ...bare } = result;
        expect(collapseResults([result, bare], f)).toEqual([
            {
                check: 'control-chars',
                invocation: ['ls', '{fixture}'],
                verdict: 'pass',
                reason: 'ok',
                evidence: 'in {fixture}/x',
                data: { n: 3, ok: true, none: null, list: ['{fixture}/a'] },
            },
            {
                check: 'control-chars',
                invocation: ['ls', '{fixture}'],
                verdict: 'pass',
                reason: 'ok',
                data: { n: 3, ok: true, none: null, list: ['{fixture}/a'] },
            },
        ]);
    });
});
