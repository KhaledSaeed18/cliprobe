import { describe, expect, it } from 'vitest';
import type { Result, Verdict } from '../src/core/types.ts';
import { countVerdicts, summaryLine } from '../src/report/summary.ts';

const result = (verdict: Verdict): Result => ({
    check: 'c',
    invocation: ['x'],
    verdict,
    reason: 'r',
});

describe('summary', () => {
    it('counts every verdict, zero included', () => {
        expect(countVerdicts([result('fail'), result('fail'), result('pass')])).toEqual({
            pass: 1,
            fail: 2,
            warn: 0,
            skip: 0,
            error: 0,
            info: 0,
        });
    });

    it('mentions info and could-not-run only when there are some', () => {
        expect(summaryLine(countVerdicts([result('pass')]))).toBe(
            '0 failed, 0 warned, 1 passed, 0 skipped'
        );
        expect(summaryLine(countVerdicts([result('info'), result('error')]))).toBe(
            '0 failed, 0 warned, 0 passed, 0 skipped, 1 info, 1 could not run'
        );
    });
});
