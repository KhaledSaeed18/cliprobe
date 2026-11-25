import { describe, expect, it } from 'vitest';
import type { Result } from '../src/core/types.ts';
import { formatHuman } from '../src/report/human.ts';
import type { Report } from '../src/report/types.ts';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

const report = (results: Result[]): Report => ({
    version: '9.9.9',
    command: 'tool',
    checks: [...new Set(results.map((r) => r.check))],
    strict: false,
    results,
});

describe('formatHuman', () => {
    it('escapes the reason, which can quote the command path in a spawn error', () => {
        const path = `./evil${ESC}]0;PWNED${BEL}${ESC}[2J`;
        const out = formatHuman(
            report([
                {
                    check: 'stdin',
                    invocation: [path, '--version'],
                    verdict: 'error',
                    reason: `could not start: spawn ${path} ENOENT`,
                },
            ]),
            { color: false }
        );
        expect(out).not.toContain(ESC);
        expect(out).not.toContain(BEL);
        expect(out).toContain('could not start: spawn ./evil\\x1b]0;PWNED\\x07\\x1b[2J ENOENT');
    });
});

const row = (invocation: string[], evidence?: string): Result => ({
    check: 'pipe-escapes',
    invocation,
    verdict: 'fail',
    reason: 'printed terminal control codes into a pipe',
    ...(evidence === undefined ? {} : { evidence }),
});
const human = (results: Result[]): string[] =>
    formatHuman(report(results), { color: false }).split('\n');

describe('formatHuman evidence', () => {
    it('doubles a backslash from the program, so text never looks like an escape', () => {
        const lines = human([row(['tool'], `literal: \\x1b[2J and real: ${ESC}[2J ST: ${ESC}\\`)]);
        expect(lines).toContain(
            '               literal: \\\\x1b[2J and real: \\x1b[2J ST: \\x1b\\\\'
        );
    });

    it('cuts long evidence at a word, says so, and never splits an escape', () => {
        const words = Array.from({ length: 60 }, (_, i) => `w${i}${ESC}[1m`).join(' ');
        const evidence = human([row(['tool'], words)])[3] ?? '';
        const shown = evidence.trimStart();
        expect(shown).toMatch(/ \.\.\. \(--json has the rest\)$/);
        const kept = shown.replace(/ \.\.\. \(--json has the rest\)$/, '');
        expect(kept.length).toBeLessThanOrEqual(200);
        expect(kept).toMatch(/\\x1b\[1m$/);
        expect(words.startsWith(kept.replaceAll('\\x1b', ESC))).toBe(true);
    });

    it('cuts a long word between escapes, not inside one', () => {
        const evidence = human([row(['tool'], ESC.repeat(100))])[3]?.trimStart() ?? '';
        expect(evidence).toBe(`${'\\x1b'.repeat(50)} ... (--json has the rest)`);
    });

    it('leaves short evidence whole', () => {
        expect(human([row(['tool'], 'stdout line 1: hi')])[3]).toBe(
            '               stdout line 1: hi'
        );
    });
});

describe('formatHuman layout', () => {
    it('puts the reason under an invocation too long for the column', () => {
        const long = ['node', `/a/${'very-long-folder/'.repeat(4)}cli.js`, '--check', 'stdin'];
        const lines = human([row(['tool', '--help']), row(long, 'stdout line 1: x')]);
        expect(lines.slice(2)).toEqual([
            '  FAIL   tool --help  printed terminal control codes into a pipe',
            `  FAIL   ${long.join(' ')}`,
            '                      printed terminal control codes into a pipe',
            '                      stdout line 1: x',
            '',
            '2 failed, 0 warned, 0 passed, 0 skipped',
            '',
        ]);
    });

    it('keeps every line within 80 columns when invocations and reasons are short', () => {
        const lines = human([row(['tool', '--version']), row(['tool', '--help'])]);
        expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(80);
    });
});
