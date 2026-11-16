import type { Result, Verdict } from '../core/types.ts';

export type VerdictCounts = Record<Verdict, number>;

export function countVerdicts(results: readonly Result[]): VerdictCounts {
    const counts: VerdictCounts = { pass: 0, fail: 0, warn: 0, skip: 0, error: 0, info: 0 };
    for (const r of results) counts[r.verdict]++;
    return counts;
}

/**
 * "2 failed, 0 warned, 2 passed, 2 skipped", plus info and could-not-run when
 * present, and a note when --strict makes warnings fail.
 */
export function summaryLine(c: VerdictCounts, strict = false): string {
    const info = c.info ? `, ${c.info} info` : '';
    const errors = c.error ? `, ${c.error} could not run` : '';
    const mode = strict ? ' (--strict: warnings fail)' : '';
    return `${c.fail} failed, ${c.warn} warned, ${c.pass} passed, ${c.skip} skipped${info}${errors}${mode}`;
}
