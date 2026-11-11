import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECKS } from '../src/checks/index.ts';
import { cliprobeBin, fixture, ROOT } from './helpers/cli.ts';

// Everything else runs the CLI in-process; these run the built, published file
// as a real process, for what only a real process shows.
const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as { version: string };
const node = process.execPath;

describe('the built cliprobe', () => {
    it('prints the package version', () => {
        const r = cliprobeBin(['--version']);
        expect(r.status).toBe(0);
        expect(r.stdout).toBe(`${pkg.version}\n`);
    });

    it('lists every check in --help', () => {
        const r = cliprobeBin(['--help']);
        expect(r.status).toBe(0);
        for (const check of CHECKS) expect(r.stdout).toContain(`  ${check.name}`);
    });

    it('exits 0 when nothing fails, 1 when a check fails, 2 on a usage error', () => {
        expect(cliprobeBin(['--check', 'closed-pipe', '--', 'printf', 'x']).status).toBe(0);
        expect(cliprobeBin(['--check', 'closed-pipe', '--', node, fixture('crash')]).status).toBe(
            1
        );
        expect(cliprobeBin(['--bogus']).status).toBe(2);
    });

    it('prints no color when stdout is not a terminal', () => {
        const r = cliprobeBin(['--check', 'closed-pipe', '--', node, fixture('crash')]);
        expect(r.stdout).toMatch(/^ {2}FAIL /m);
        expect(r.stdout).not.toContain('\u001b');
    });
});
