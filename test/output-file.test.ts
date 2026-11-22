import { execFileSync, spawn } from 'node:child_process';
import {
    chmodSync,
    closeSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMLValidator } from 'fast-xml-parser';
import { afterAll, describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../src/cli/args.ts';
import { runInterruptCleanups } from '../src/core/interrupt.ts';
import { reportPathProblem, reportTarget, writeReportFile } from '../src/report/write.ts';
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
    it('creates missing parent folders and leaves no temporary file', async () => {
        const path = join(scratch, 'a', 'b', 'report.txt');
        await writeReportFile(path, 'hello\n');
        expect(readFileSync(path, 'utf8')).toBe('hello\n');
        expect(readdirSync(join(scratch, 'a', 'b'))).toEqual(['report.txt']);
    });

    it('replaces an existing file whole', async () => {
        const path = join(scratch, 'replace.txt');
        writeFileSync(path, 'old content that is longer\n');
        await writeReportFile(path, 'new\n');
        expect(readFileSync(path, 'utf8')).toBe('new\n');
    });

    it("keeps an existing file's mode", async () => {
        for (const mode of [0o600, 0o640, 0o444]) {
            const path = join(scratch, `mode-${mode.toString(8)}.txt`);
            writeFileSync(path, 'old\n');
            chmodSync(path, mode);
            await writeReportFile(path, 'new\n');
            expect(statSync(path).mode & 0o777).toBe(mode);
            expect(readFileSync(path, 'utf8')).toBe('new\n');
        }
    });

    it('writes through a symlink to its target, keeping the link', async () => {
        const dir = mkdtempSync(join(scratch, 'link-'));
        writeFileSync(join(dir, 'target.txt'), 'old\n');
        symlinkSync('target.txt', join(dir, 'link.json'));
        await writeReportFile(join(dir, 'link.json'), 'new\n');
        expect(lstatSync(join(dir, 'link.json')).isSymbolicLink()).toBe(true);
        expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('new\n');
        expect(readdirSync(dir).sort()).toEqual(['link.json', 'target.txt']);
    });

    it('creates the target of a dangling symlink, in its own folder', async () => {
        const dir = mkdtempSync(join(scratch, 'dangling-'));
        symlinkSync(join('sub', 'target.txt'), join(dir, 'link.json'));
        await writeReportFile(join(dir, 'link.json'), 'new\n');
        expect(lstatSync(join(dir, 'link.json')).isSymbolicLink()).toBe(true);
        expect(readFileSync(join(dir, 'sub', 'target.txt'), 'utf8')).toBe('new\n');
    });

    it('writes into a FIFO instead of replacing it', async () => {
        const fifo = join(mkdtempSync(join(scratch, 'fifo-')), 'fifo');
        execFileSync('mkfifo', [fifo]);
        const reader = spawn('cat', [fifo]);
        let received = '';
        reader.stdout.on('data', (chunk: Buffer) => (received += chunk.toString()));
        const closed = new Promise((done) => reader.on('close', done));
        await writeReportFile(fifo, 'through the pipe\n');
        await closed;
        expect(received).toBe('through the pipe\n');
        expect(lstatSync(fifo).isFIFO()).toBe(true);
    });

    it('writes through /dev/fd/N to the file that descriptor is open on', async () => {
        const path = join(scratch, 'fd.txt');
        const fd = openSync(path, 'w');
        try {
            await writeReportFile(`/dev/fd/${fd}`, 'via the descriptor\n');
        } finally {
            closeSync(fd);
        }
        expect(readFileSync(path, 'utf8')).toBe('via the descriptor\n');
        expect(readdirSync(scratch).filter((n) => n.includes('.cliprobe-'))).toEqual([]);
    });

    it('says a directory is a directory', async () => {
        const dir = mkdtempSync(join(scratch, 'dir-'));
        await expect(writeReportFile(dir, 'x')).rejects.toThrow(/^is a directory$/);
        await expect(writeReportFile(`${join(dir, 'new')}/`, 'x')).rejects.toThrow(
            /^names a folder, not a file$/
        );
        expect(readdirSync(dir)).toEqual([]);
    });

    it('says which part of the path is a file, not a folder', async () => {
        const blocker = join(scratch, 'blocker');
        writeFileSync(blocker, '');
        await expect(writeReportFile(join(blocker, 'sub', 'r.json'), 'x')).rejects.toThrow(
            `${blocker} is not a folder`
        );
    });

    // Root ignores permissions, so these can only fail as an ordinary user.
    const isRoot = process.getuid?.() === 0;
    it.skipIf(isRoot)(
        'throws when it cannot write, leaving neither the report nor a temporary file',
        async () => {
            const dir = join(scratch, 'locked');
            await writeReportFile(join(dir, 'seed.txt'), '');
            chmodSync(dir, 0o500);
            try {
                await expect(writeReportFile(join(dir, 'report.txt'), 'x')).rejects.toThrow(
                    /^permission denied$/
                );
                expect(reportPathProblem(join(dir, 'report.txt'))).toBe('permission denied');
                expect(readdirSync(dir)).toEqual(['seed.txt']);
            } finally {
                chmodSync(dir, 0o700);
            }
        }
    );

    it.skipIf(isRoot)('writes a writable file in place when its folder is read-only', async () => {
        const dir = join(scratch, 'locked-writable');
        await writeReportFile(join(dir, 'report.txt'), 'old\n');
        chmodSync(dir, 0o500);
        try {
            expect(reportTarget(join(dir, 'report.txt')).how).toBe('direct');
            await writeReportFile(join(dir, 'report.txt'), 'new\n');
            expect(readFileSync(join(dir, 'report.txt'), 'utf8')).toBe('new\n');
            expect(readdirSync(dir)).toEqual(['report.txt']);
        } finally {
            chmodSync(dir, 0o700);
        }
    });

    it('removes the temporary file if cliprobe is interrupted mid-write', async () => {
        const path = join(mkdtempSync(join(scratch, 'interrupt-')), 'report.txt');
        const temp = `${path}.cliprobe-${process.pid}.tmp`;
        // The cleanup is registered before the first await: stand in for a half-written
        // temporary file, then run the cleanups as the signal handler would.
        const pending = writeReportFile(path, 'x');
        writeFileSync(temp, 'half a report');
        runInterruptCleanups();
        expect(existsSync(temp)).toBe(false);
        await pending;
    });
});

describe('reportPathProblem', () => {
    it('accepts what writeReportFile accepts, creating nothing', () => {
        const path = join(scratch, 'not', 'yet', 'there.json');
        expect(reportPathProblem(path)).toBeUndefined();
        expect(existsSync(join(scratch, 'not'))).toBe(false);
        expect(reportPathProblem('/dev/stdout')).toBeUndefined();
    });

    it('rejects a directory and a path through a file', () => {
        expect(reportPathProblem(scratch)).toBe('is a directory');
        const blocker = join(scratch, 'blocker2');
        writeFileSync(blocker, '');
        expect(reportPathProblem(join(blocker, 'r.json'))).toBe(`${blocker} is not a folder`);
    });

    it('rejects a symlink loop', () => {
        const dir = mkdtempSync(join(scratch, 'loop-'));
        symlinkSync('b', join(dir, 'a'));
        symlinkSync('a', join(dir, 'b'));
        expect(reportPathProblem(join(dir, 'a'))).toBe('too many levels of symbolic links');
    });
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

    it('exits 2 before running any probe when the path cannot be written', async () => {
        const blocker = join(scratch, 'not-a-dir');
        writeFileSync(blocker, '');
        const started = performance.now();
        const r = await cliprobe([
            '-o',
            join(blocker, 'report.json'),
            '--format',
            'json',
            '--check',
            'closed-pipe',
            '--',
            'sleep',
            '3',
        ]);
        expect(performance.now() - started).toBeLessThan(2000);
        expect(r.status).toBe(2);
        expect(r.stdout).toBe('');
        expect(r.stderr).toBe(
            `cliprobe: cannot write the report to ${join(blocker, 'report.json')}: ${blocker} is not a folder\n`
        );
        expect(existsSync(join(blocker, 'report.json'))).toBe(false);
    });

    it('exits 2 up front when the path is a directory', async () => {
        const r = await cliprobe(['-o', scratch, '--check', 'closed-pipe', '--', 'sleep', '3']);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/^cliprobe: cannot write the report to .*: is a directory\n$/);
    });

    it('escapes control characters in the path it names', async () => {
        const path = join(scratch, `evil${String.fromCharCode(0x1b)}[2J`);
        mkdirSync(path, { recursive: true });
        const r = await cliprobe(['-o', path, '--check', 'closed-pipe', '--', 'printf', 'x']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('evil\\x1b[2J: is a directory');
        expect(r.stderr).not.toContain(String.fromCharCode(0x1b));
    });

    it('prints the human report before the error when the write still fails at the end', async () => {
        // The probe itself turns the path into a directory, after the check up front.
        const path = join(scratch, 'becomes-a-dir');
        const r = await cliprobe([
            '--json',
            '-o',
            path,
            '--check',
            'closed-pipe',
            '--',
            'mkdir',
            path,
        ]);
        expect(r.status).toBe(2);
        expect(r.stdout).toMatch(/^cliprobe .*closed-pipe check for mkdir\n\n {2}SKIP /);
        expect(r.stdout).toMatch(/0 failed, 0 warned, 0 passed, 1 skipped\n$/);
        expect(r.stderr).toBe(`cliprobe: could not write ${path}: is a directory\n`);
    });
});
