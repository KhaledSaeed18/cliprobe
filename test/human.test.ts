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
