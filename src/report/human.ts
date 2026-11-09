import { safe } from '../core/safe.ts';
import type { Result, Verdict } from '../core/types.ts';

const COLORS: Record<Verdict, number> = { pass: 32, fail: 31, warn: 33, skip: 90, error: 35 };

export function formatHuman(
    version: string,
    command: string,
    results: readonly Result[],
    useColor: boolean
): string {
    const paint = (verdict: Verdict): string => {
        const label = verdict.toUpperCase().padEnd(5);
        return useColor ? `\x1b[${COLORS[verdict]}m${label}\x1b[0m` : label;
    };
    const width = Math.max(...results.map((r) => safe(r.invocation.join(' ')).length));
    const lines = [`cliprobe ${version}: closed-pipe check for ${safe(command)}`, ''];
    for (const r of results) {
        lines.push(
            `  ${paint(r.verdict)}  ${safe(r.invocation.join(' ')).padEnd(width)}  ${r.reason}`
        );
        if (r.evidence) {
            lines.push(
                `  ${' '.repeat(5)}  ${' '.repeat(width)}  ${safe(r.evidence).slice(0, 200)}`
            );
        }
    }
    const count = (v: Verdict): number => results.filter((r) => r.verdict === v).length;
    const errors = count('error') ? `, ${count('error')} could not run` : '';
    lines.push(
        '',
        `${count('fail')} failed, ${count('warn')} warned, ${count('pass')} passed, ${count('skip')} skipped${errors}`
    );
    return lines.join('\n') + '\n';
}
