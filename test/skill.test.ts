import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKS } from '../src/checks/index.ts';
import { VERSION } from '../src/version.ts';
import { cliprobe, probeJson, type Report } from './helpers/cli.ts';

const exec = promisify(execFile);

const SKILL = join(import.meta.dirname, '..', 'skills', 'cliprobe');
const EVALS = join(SKILL, '..', 'evals', 'cliprobe');
const MAKE_FIXTURES = join(EVALS, 'make-fixtures.mjs');

async function text(relPath: string): Promise<string> {
    return readFile(join(SKILL, relPath), 'utf8');
}

/** The frontmatter's top-level `key: value` pairs; enough for the fields the spec requires. */
function frontmatter(markdown: string): Record<string, string> {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
    if (!match?.[1]) throw new Error('SKILL.md has no frontmatter');
    const fields: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const field = /^([a-z-]+):\s*(.*)$/.exec(line);
        if (field?.[1] !== undefined) fields[field[1]] = field[2] ?? '';
    }
    return fields;
}

/** Results as "verdict check probe-args", for comparing whole runs at a glance. */
function verdicts(report: Report): string[] {
    return report.results.map((r) => `${r.verdict} ${r.check} ${r.invocation.slice(1).join(' ')}`);
}

describe('agent skill: SKILL.md', () => {
    it('has valid Agent Skills frontmatter', async () => {
        const fields = frontmatter(await text('SKILL.md'));
        expect(fields['name']).toBe('cliprobe');
        const description = fields['description'] ?? '';
        expect(description.length).toBeGreaterThan(50);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/[<>]/);
        expect((fields['compatibility'] ?? '').length).toBeLessThanOrEqual(500);
    });

    it('requires a released cliprobe version and asks npx for it explicitly', async () => {
        const skill = await text('SKILL.md');
        const floor = /written for cliprobe \*\*(\d+)\.(\d+) or later, below (\d+)\*\*/.exec(skill);
        expect(floor).not.toBeNull();
        const [major, minor, below] = (floor?.slice(1) ?? []).map(Number);
        // A plain "@1" lets npx reuse an older cached 1.x, so the range must carry the floor.
        expect(skill).toContain(`npx --yes "cliprobe@^${major}.${minor}" --version`);
        expect(below).toBe((major ?? 0) + 1);
        const [ownMajor, ownMinor] = VERSION.split('.').map(Number);
        expect(major).toBe(ownMajor);
        expect(minor).toBeLessThanOrEqual(ownMinor ?? 0);
    });

    it('links only to files that exist', async () => {
        const docs = [
            'SKILL.md',
            'references/fixes.md',
            'references/json-report.md',
            '../README.md',
        ];
        for (const doc of docs) {
            const links = [...(await text(doc)).matchAll(/\]\(([^)#]+)\)/g)]
                .map((m) => m[1] ?? '')
                .filter((target) => !/^[a-z]+:/.test(target));
            const base = join(SKILL, doc, '..');
            const broken = links.filter((target) => !existsSync(join(base, target)));
            expect(broken.map((target) => `${doc}: ${target}`)).toEqual([]);
        }
    });

    it('names every check and only uses options the CLI documents', async () => {
        const help = (await cliprobe(['--help'])).stdout;
        const docs = (await text('SKILL.md')) + (await text('references/json-report.md'));
        for (const check of CHECKS) expect(docs).toContain(`\`${check.name}\``);
        // Flags of other programs in the examples: npx, docker, make-fixtures.mjs and the probed CLI.
        const foreign = new Set(['--yes', '--rm', '--network', '--verify', '--port']);
        const flags = new Set(docs.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? []);
        expect(flags.size).toBeGreaterThan(8);
        const unknown = [...flags].filter(
            (flag) => !foreign.has(flag) && !new RegExp(`${flag}(?![\\w-])`).test(help)
        );
        expect(unknown).toEqual([]);
    });
});

describe('agent skill: eval fixtures', () => {
    let root: string;

    beforeAll(async () => {
        root = join(await mkdtemp(join(tmpdir(), 'cliprobe-skill-')), 'fixtures');
        await exec(process.execPath, [MAKE_FIXTURES, root]);
    });

    afterAll(async () => {
        await rm(join(root, '..'), { recursive: true, force: true });
    });

    const probes = ['watch', 'list {fixture}'];

    it('evals.json names every fixture program it measures', async () => {
        const evals = await readFile(join(EVALS, 'evals.json'), 'utf8');
        const parsed = JSON.parse(evals) as { skill_name: string; evals: { prompt: string }[] };
        expect(parsed.skill_name).toBe('cliprobe');
        expect(parsed.evals.every((e) => e.prompt.includes('{fixtures}'))).toBe(true);
        expect(evals).toContain('7 failures');
        expect(evals).toContain('21 passed, 4 skipped');
    });

    it('notes-cli: fails where evals.json says, and nowhere else', async () => {
        const { status, report } = await probeJson([join(root, 'notes-cli', 'cli.js')], {
            probes,
        });
        expect(status).toBe(1);
        expect(report.summary).toMatchObject({ fail: 7, warn: 0, error: 0 });
        expect(verdicts(report).filter((v) => v.startsWith('fail'))).toEqual([
            'fail closed-pipe --version',
            'fail closed-pipe --help',
            'fail closed-pipe watch',
            'fail closed-pipe list {fixture}',
            'fail color --help',
            'fail ctrl-c watch',
            'fail control-chars list {fixture}',
        ]);
    });

    it('notes-cli-fixed: passes every check that can judge it', async () => {
        const { status, report } = await probeJson([join(root, 'notes-cli-fixed', 'cli.js')], {
            probes,
        });
        expect(status).toBe(0);
        expect(report.summary).toMatchObject({ pass: 21, fail: 0, warn: 0, skip: 4, error: 0 });
    });

    it('verify mode detects changed, deleted and added files', async () => {
        const verify = (): Promise<{ stdout: string }> =>
            exec(process.execPath, [MAKE_FIXTURES, '--verify', root]);
        expect((await verify()).stdout).toContain('unchanged');

        const cli = join(root, 'notes-cli', 'cli.js');
        const original = await readFile(cli);
        await writeFile(cli, 'edited');
        await expect(verify()).rejects.toMatchObject({
            stderr: expect.stringContaining('changed: notes-cli/cli.js'),
        });
        await writeFile(cli, original);

        await writeFile(join(root, 'notes-cli', 'extra.js'), '');
        await expect(verify()).rejects.toMatchObject({
            stderr: expect.stringContaining('added: notes-cli/extra.js'),
        });
        await rm(join(root, 'notes-cli', 'extra.js'));
        expect((await verify()).stdout).toContain('unchanged');
    });

    it('refuses to overwrite a directory it did not create', async () => {
        const other = await mkdtemp(join(tmpdir(), 'cliprobe-skill-other-'));
        try {
            await writeFile(join(other, 'precious.txt'), 'keep me');
            await expect(exec(process.execPath, [MAKE_FIXTURES, other])).rejects.toMatchObject({
                stderr: expect.stringContaining('refusing to overwrite'),
            });
            expect(await readFile(join(other, 'precious.txt'), 'utf8')).toBe('keep me');
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });
});
