import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ptySupport } from '../src/core/pty.ts';
import { run } from '../src/core/run.ts';
import {
    cannotExecute,
    commandProblem,
    findCommand,
    shellFallbackError,
} from '../src/core/which.ts';
import { cliprobe, runCheck } from './helpers/cli.ts';

const dir = mkdtempSync(join(tmpdir(), 'cliprobe-which-'));
writeFileSync(join(dir, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
writeFileSync(join(dir, 'data'), 'x', { mode: 0o644 });
// Executable, but neither a binary of this system nor a script: ENOEXEC.
const garbage = join(dir, 'garbage');
writeFileSync(garbage, 'garbage\0\x01binary', { mode: 0o755 });
writeFileSync(join(dir, 'plain-script'), 'echo hi\n', { mode: 0o755 });
writeFileSync(join(dir, 'bad-shebang'), '#!/nonexistent/interp\necho hi\n', { mode: 0o755 });
writeFileSync(join(dir, 'env-missing'), '#!/usr/bin/env cliprobe-no-such-interp\n', {
    mode: 0o755,
});
writeFileSync(join(dir, 'env-flag'), '#!/usr/bin/env -S sh -e\necho hi\n', { mode: 0o755 });
writeFileSync(join(dir, 'blank-shebang'), '#!\necho hi\n', { mode: 0o755 });
writeFileSync(join(dir, 'not-exec-interp'), `#!${join(dir, 'data')}\n`, { mode: 0o755 });
writeFileSync(join(dir, 'dir-interp'), `#!${dir}\n`, { mode: 0o755 });
mkdirSync(join(dir, 'subdir'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('findCommand', () => {
    it('searches PATH in order', () => {
        expect(findCommand('tool', `/no/such/dir:${dir}`)).toBe(join(dir, 'tool'));
    });

    it('skips files that are not executable, and directories', () => {
        expect(findCommand('data', dir)).toBeUndefined();
        expect(findCommand(basename(dir), tmpdir())).toBeUndefined();
    });

    it('takes a path with a slash as given', () => {
        expect(findCommand(join(dir, 'tool'), '')).toBe(join(dir, 'tool'));
        expect(findCommand(join(dir, 'missing'))).toBeUndefined();
    });

    it('uses the real PATH by default', () => {
        expect(findCommand('sh')).toMatch(/\/sh$/);
        expect(findCommand('cliprobe-no-such-command-xyz')).toBeUndefined();
    });
});

describe('commandProblem', () => {
    it.each([
        ['a missing path', join(dir, 'missing'), 'command not found: <dir>/missing'],
        [
            'a missing command',
            'cliprobe-no-such-command-xyz',
            'command not found: cliprobe-no-such-command-xyz',
        ],
        ['a directory', join(dir, 'subdir'), '<dir>/subdir is a directory'],
        [
            'a file without the execute bit',
            join(dir, 'data'),
            '<dir>/data is not executable (chmod +x?)',
        ],
        ['a device', '/dev/null', '/dev/null is not a regular file'],
        [
            'a missing interpreter',
            join(dir, 'bad-shebang'),
            '<dir>/bad-shebang: interpreter /nonexistent/interp not found',
        ],
        [
            'a program env cannot find',
            join(dir, 'env-missing'),
            '<dir>/env-missing: interpreter cliprobe-no-such-interp not found (/usr/bin/env cliprobe-no-such-interp)',
        ],
        [
            'an interpreter without the execute bit',
            join(dir, 'not-exec-interp'),
            '<dir>/not-exec-interp: interpreter <dir>/data is not executable',
        ],
        [
            'a directory as interpreter',
            join(dir, 'dir-interp'),
            '<dir>/dir-interp: interpreter <dir> is not executable',
        ],
    ])('names %s', (_name, command, problem) => {
        expect(commandProblem(command)?.replaceAll(dir, '<dir>')).toBe(problem);
    });

    it.each([
        ['a script', join(dir, 'tool')],
        ['a script found on PATH', 'tool'],
        ['a script without #!', join(dir, 'plain-script')],
        ['env with a flag', join(dir, 'env-flag')],
        ['an empty #! line', join(dir, 'blank-shebang')],
        ['a binary', 'sh'],
    ])('accepts %s', (_name, command) => {
        expect(commandProblem(command, `${dir}:${process.env['PATH'] ?? ''}`)).toBeUndefined();
    });

    it('says why before any check runs, escaped, and exits 2', async () => {
        for (const [target, message] of [
            [join(dir, 'subdir'), 'is a directory'],
            [join(dir, 'data'), 'is not executable (chmod +x?)'],
            [join(dir, 'bad-shebang'), 'interpreter /nonexistent/interp not found'],
        ] as const) {
            const r = await cliprobe(['--check', 'stdin', '--', target]);
            expect(r.status).toBe(2);
            expect(r.stdout).toBe('');
            expect(r.stderr).toBe(
                `cliprobe: ${target}${message.startsWith('interp') ? ': ' : ' '}${message}\n`
            );
        }
    });
});

describe('a file this system cannot run', () => {
    it('is told apart from scripts and real programs', () => {
        expect(cannotExecute(garbage)).toBe(true);
        expect(cannotExecute(join(dir, 'tool'))).toBe(false);
        expect(cannotExecute(join(dir, 'plain-script'))).toBe(false);
        expect(cannotExecute(join(dir, 'missing'))).toBe(false);
    });

    it("is recognized when Linux's /bin/sh runs it instead, and only then", () => {
        const said = `${garbage}: 1: garbage\x01binary: not found\n`;
        expect(shellFallbackError(garbage, 127, said)).toBe(
            `${garbage} is not a program this system can run (/bin/sh tried it as a script and exited 127)`
        );
        expect(
            shellFallbackError('garbage', 126, `${garbage}: cannot execute binary file`, dir)
        ).toMatch(/^garbage is not a program/);
        expect(shellFallbackError(garbage, 0, said)).toBeUndefined();
        expect(shellFallbackError(garbage, 127, 'sh: 1: other: not found\n')).toBeUndefined();
        expect(shellFallbackError(join(dir, 'tool'), 127, said)).toBeUndefined();
        expect(shellFallbackError(join(dir, 'missing'), 127, said)).toBeUndefined();
    });

    it('is reported as could-not-run by a run, on every platform', async () => {
        const r = await run(garbage, ['--version'], { timeout: 5000 });
        expect(r.spawnError).toMatch(/is not a program this system can run/);
    });

    it.skipIf(!ptySupport().ok)('is could-not-run under a terminal too', async () => {
        const [result] = await runCheck('restore', [garbage, '--version']);
        expect(result).toMatchObject({ verdict: 'error' });
        expect(result?.reason).toMatch(/is not a program this system can run/);
    });

    it('makes cliprobe exit 2, as nothing could be judged', async () => {
        const r = await cliprobe(['--', garbage]);
        expect(r.stdout).not.toMatch(/PASS|FAIL|WARN/);
        expect(r.status).toBe(2);
    });
});
