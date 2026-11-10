import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
    collapseFixture,
    createFixture,
    expandFixture,
    HOSTILE_NAMES,
    PLAIN_NAME,
    usesFixture,
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

    it('reaches the program as a real directory that is gone afterwards, and reports as {fixture}', () => {
        const scratch = mkdtempSync(join(tmpdir(), 'cliprobe-test-'));
        onTestFinished(() => rmSync(scratch, { recursive: true, force: true }));
        const out = join(scratch, 'arg');
        const { report } = probeJson([process.execPath, fixture('record-arg'), '{fixture}', out], {
            checks: ['closed-pipe'],
        });
        const seen = readFileSync(out, 'utf8');
        expect(seen).toMatch(/cliprobe-fixture-/);
        expect(existsSync(seen)).toBe(false);
        expect(report.results[0]?.invocation.slice(2)).toEqual(['{fixture}', out]);
    });
});
