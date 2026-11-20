import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECKS } from '../src/checks/index.ts';

const root = new URL('../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const TEMPLATES = '.github/ISSUE_TEMPLATE/';

/** The options of a dropdown in an issue form, by its id (the forms are written by hand). */
function dropdownOptions(form: string, id: string): string[] {
    const block = form.split(/\n {2}- type: /).find((b) => b.includes(`\n    id: ${id}\n`));
    if (!block) throw new Error(`no field with id ${id}`);
    const options = /\n {6}options:\n((?: {8}- .*\n)+)/.exec(block);
    if (!options?.[1]) throw new Error(`field ${id} has no options`);
    return options[1]
        .trimEnd()
        .split('\n')
        .map((line) => line.replace(/^ {8}- /, ''));
}

describe('issue forms', () => {
    it('list every check, in registry order, in the wrong verdict form', () => {
        const form = read(`${TEMPLATES}wrong_verdict.yml`);
        expect(dropdownOptions(form, 'check')).toEqual(CHECKS.map((c) => c.name));
    });

    it('exist for every template link in the docs', () => {
        const forms = readdirSync(new URL(TEMPLATES, root));
        const docs = ['README.md', 'CONTRIBUTING.md', 'ACCESSIBILITY.md', 'SECURITY.md'];
        const linked = docs.flatMap((doc) =>
            [...read(doc).matchAll(/[?&]template=([\w.-]+)/g)].map((m) => m[1])
        );
        expect(linked.length).toBeGreaterThan(0);
        for (const name of linked) expect(forms).toContain(name);
    });

    it('turn off blank issues, so every report goes through a form', () => {
        expect(read(`${TEMPLATES}config.yml`)).toMatch(/^blank_issues_enabled: false$/m);
    });
});

describe('community files', () => {
    it('are all present', () => {
        const files = [
            'CODE_OF_CONDUCT.md',
            'CONTRIBUTING.md',
            'SECURITY.md',
            'ACCESSIBILITY.md',
            '.github/pull_request_template.md',
        ];
        expect(files.filter((file) => !existsSync(new URL(file, root)))).toEqual([]);
    });
});
