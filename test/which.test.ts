import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findCommand } from '../src/core/which.ts';

const dir = mkdtempSync(join(tmpdir(), 'cliprobe-which-'));
writeFileSync(join(dir, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
writeFileSync(join(dir, 'data'), 'x', { mode: 0o644 });
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
