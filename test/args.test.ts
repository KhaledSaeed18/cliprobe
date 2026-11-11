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

describe('selectChecks', () => {
    it('selects every check but no info check when no names are given', () => {
        expect(selectChecks([]).checks.map((c) => c.name)).toEqual([
            'closed-pipe',
            'color',
            'ctrl-c',
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
            /one of human, json, got "xml"/
        );
        expect(() => parseArgs(['--format'])).toThrow(UsageError);
    });
});
