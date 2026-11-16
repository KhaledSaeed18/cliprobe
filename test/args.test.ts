import { describe, expect, it } from 'vitest';
import { selectChecks } from '../src/checks/index.ts';
import { parseArgs, UsageError } from '../src/cli/args.ts';

describe('parseArgs --check', () => {
    it('collects repeated and comma-separated names in order', () => {
        const opts = parseArgs(['--check', 'b', '--check=a,c', '--', 'node']);
        expect(opts.checks).toEqual(['b', 'a', 'c']);
        expect(opts.command).toBe('node');
    });

    it('ignores empty names between commas', () => {
        expect(parseArgs(['--check', ' a, ,b ', 'node']).checks).toEqual(['a', 'b']);
    });

    it('rejects a missing or empty name', () => {
        expect(() => parseArgs(['--check'])).toThrow(UsageError);
        expect(() => parseArgs(['--check='])).toThrow(UsageError);
        expect(() => parseArgs(['--check', ',', 'node'])).toThrow(UsageError);
    });

    it('defaults to no names, which means every check of kind check', () => {
        expect(parseArgs(['node']).checks).toEqual([]);
    });
});

describe('parseArgs --skip and --strict', () => {
    it('collects --skip names like --check, separately', () => {
        const opts = parseArgs(['--skip', 'color', '--skip=restore,stdin', '--check', 'a', 'node']);
        expect(opts.skip).toEqual(['color', 'restore', 'stdin']);
        expect(opts.checks).toEqual(['a']);
    });

    it('rejects --skip without a name', () => {
        expect(() => parseArgs(['--skip'])).toThrow(/--skip needs a check name/);
        expect(() => parseArgs(['--skip=', 'node'])).toThrow(/--skip needs a check name/);
    });

    it('is not strict unless asked', () => {
        expect(parseArgs(['node']).strict).toBe(false);
        expect(parseArgs(['--strict', 'node']).strict).toBe(true);
    });
});

describe('selectChecks', () => {
    it('selects every check but no info check when no names are given', () => {
        expect(selectChecks([]).checks.map((c) => c.name)).toEqual([
            'closed-pipe',
            'color',
            'pipe-escapes',
            'stdin',
            'ctrl-c',
            'sigterm',
            'restore',
            'control-chars',
        ]);
    });

    it('selects an info check when it is named', () => {
        expect(selectChecks(['startup']).checks.map((c) => c.name)).toEqual(['startup']);
    });

    it('selects by name and ignores duplicates', () => {
        const { checks, unknown } = selectChecks(['closed-pipe', 'closed-pipe']);
        expect(checks.map((c) => c.name)).toEqual(['closed-pipe']);
        expect(unknown).toEqual([]);
    });

    it('reports unknown names once each', () => {
        expect(selectChecks(['nope', 'closed-pipe', 'nope']).unknown).toEqual(['nope']);
    });

    it('leaves out skipped checks, from the defaults or from the named ones', () => {
        const names = (n: string[], s: string[]): string[] =>
            selectChecks(n, s).checks.map((c) => c.name);
        expect(names([], ['color', 'restore'])).not.toContain('color');
        expect(names([], ['color', 'restore'])).toHaveLength(6);
        expect(names(['color', 'stdin'], ['color'])).toEqual(['stdin']);
        expect(names(['color'], ['color'])).toEqual([]);
    });

    it('reports an unknown skipped name', () => {
        expect(selectChecks([], ['colour']).unknown).toEqual(['colour']);
    });
});

describe('parseArgs --format', () => {
    it('defaults to human', () => {
        expect(parseArgs(['node']).format).toBe('human');
    });

    it('takes a format as the next argument or after =', () => {
        expect(parseArgs(['--format', 'json', 'node']).format).toBe('json');
        expect(parseArgs(['--format=json', 'node']).format).toBe('json');
    });

    it('treats --json as --format json, and lets the last one win', () => {
        expect(parseArgs(['--json', 'node']).format).toBe('json');
        expect(parseArgs(['--json', '--format', 'human', 'node']).format).toBe('human');
    });

    it('rejects an unknown or missing format, naming the valid ones', () => {
        expect(() => parseArgs(['--format', 'xml', 'node'])).toThrow(
            /one of human, json, markdown, junit, got "xml"/
        );
        expect(() => parseArgs(['--format'])).toThrow(UsageError);
    });
});

describe('parseArgs --bare', () => {
    it('is off by default and on when given', () => {
        expect(parseArgs(['node']).bare).toBe(false);
        expect(parseArgs(['--bare', '--', 'node']).bare).toBe(true);
    });

    it('rejects probe args after the command, which --bare would ignore', () => {
        expect(() => parseArgs(['--bare', '--', 'node', 'x.js'])).toThrow(/no arguments/);
    });
});
