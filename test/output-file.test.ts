import {
    chmodSync,
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMLValidator } from 'fast-xml-parser';
import { afterAll, describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../src/cli/args.ts';
import { writeReportFile } from '../src/report/write.ts';
import { cliprobe, fixture } from './helpers/cli.ts';

const scratch = mkdtempSync(join(tmpdir(), 'cliprobe-out-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const node = process.execPath;

describe('parseArgs --output-file', () => {
    it('takes a path after -o, --output-file or =', () => {
        expect(parseArgs(['-o', 'r.xml', 'node']).outputFile).toBe('r.xml');
        expect(parseArgs(['--output-file', 'r.xml', 'node']).outputFile).toBe('r.xml');
        expect(parseArgs(['--output-file=r.xml', 'node']).outputFile).toBe('r.xml');
        expect(parseArgs(['node']).outputFile).toBeUndefined();
    });

    it('rejects a missing path', () => {
        expect(() => parseArgs(['-o'])).toThrow(UsageError);
        expect(() => parseArgs(['--output-file='])).toThrow(/--output-file needs a file path/);
    });
});

describe('writeReportFile', () => {
    it('creates missing parent folders and leaves no temporary file', () => {
        const path = join(scratch, 'a', 'b', 'report.txt');
        writeReportFile(path, 'hello\n');
        expect(readFileSync(path, 'utf8')).toBe('hello\n');
        expect(readdirSync(join(scratch, 'a', 'b'))).toEqual(['report.txt']);
    });

    it('replaces an existing file whole', () => {
        const path = join(scratch, 'replace.txt');
        writeFileSync(path, 'old content that is longer\n');
        writeReportFile(path, 'new\n');
        expect(readFileSync(path, 'utf8')).toBe('new\n');
    });

    // Root ignores directory permissions, so this can only fail as an ordinary user.
    const isRoot = process.getuid?.() === 0;
    it.skipIf(isRoot)(
        'throws when it cannot write, leaving neither the report nor a temporary file',
        () => {
            const dir = join(scratch, 'locked');
            writeReportFile(join(dir, 'seed.txt'), '');
            chmodSync(dir, 0o500);
            try {
                expect(() => writeReportFile(join(dir, 'report.txt'), 'x')).toThrow(/EACCES/);
                expect(readdirSync(dir)).toEqual(['seed.txt']);
            } finally {
                chmodSync(dir, 0o700);
            }
        }
    );
});

describe('cliprobe --output-file', () => {
    it('writes the chosen format to the file and the human report to stdout, keeping the exit code', async () => {
        const path = join(scratch, 'ci', 'junit.xml');
        const r = await cliprobe([
            '--format',
            'junit',
            '-o',
            path,
            '--check',
            'closed-pipe',
            '--',
            node,
            fixture('crash'),
        ]);
        expect(r.status).toBe(1);
        expect(r.stdout).toMatch(/FAIL .*crashed when stdout was closed/);
        const xml = readFileSync(path, 'utf8');
        expect(XMLValidator.validate(xml)).toBe(true);
        expect(xml).toContain('<failure message="crashed when stdout was closed');
    });

    it('writes plain text, never colors, when the format is human', async () => {
        const path = join(scratch, 'human.txt');
        await cliprobe(['-o', path, '--check', 'closed-pipe', '--', 'printf', 'x']);
        expect(readFileSync(path, 'utf8')).toMatch(/^cliprobe .*\n\n {2}PASS /);
        expect(readFileSync(path, 'utf8')).not.toContain('\u001b');
    });

    it('shows {fixture}, not the temporary path, in the file', async () => {
        const path = join(scratch, 'fixture.md');
        await cliprobe([
            '--format',
            'markdown',
            '-o',
            path,
            '--check',
            'closed-pipe',
            '--',
            'ls',
            '{fixture}',
        ]);
        const text = readFileSync(path, 'utf8');
        expect(text).toContain('`ls {fixture}`');
        expect(text).not.toMatch(/cliprobe-fixture-/);
    });

    it('exits 2 with a message when the file cannot be written', async () => {
        const blocker = join(scratch, 'not-a-dir');
        writeFileSync(blocker, '');
        const r = await cliprobe([
            '-o',
            join(blocker, 'report.json'),
            '--format',
            'json',
            '--check',
            'closed-pipe',
            '--',
            'printf',
            'x',
        ]);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/^cliprobe: could not write .*not-a-dir\/report\.json: /);
        expect(existsSync(join(blocker, 'report.json'))).toBe(false);
    });
});
