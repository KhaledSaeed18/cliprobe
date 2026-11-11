import { safe } from '../core/safe.ts';
import type { Verdict } from '../core/types.ts';
import type { RenderOptions, Report } from './types.ts';

const COLORS: Record<Verdict, number> = {
    pass: 32,
    fail: 31,
    warn: 33,
    skip: 90,
    error: 35,
    info: 36,
};

export function formatHuman(
    { version, command, checks, results }: Report,
    { color }: RenderOptions
): string {
    const paint = (verdict: Verdict): string => {
        const label = verdict.toUpperCase().padEnd(5);
        return color ? `\x1b[${COLORS[verdict]}m${label}\x1b[0m` : label;
    };
    const width = Math.max(0, ...results.map((r) => safe(r.invocation.join(' ')).length));
    const noun = checks.length === 1 ? 'check' : 'checks';
    const lines = [`cliprobe ${version}: ${checks.join(', ')} ${noun} for ${safe(command)}`];
    for (const check of checks) {
        lines.push('');
        // With several checks, each gets its own heading; with one, the title says it all.
        if (checks.length > 1) lines.push(check);
        for (const r of results.filter((result) => result.check === check)) {
            lines.push(
                `  ${paint(r.verdict)}  ${safe(r.invocation.join(' ')).padEnd(width)}  ${r.reason}`
            );
            if (r.evidence) {
                lines.push(
                    `  ${' '.repeat(5)}  ${' '.repeat(width)}  ${safe(r.evidence).slice(0, 200)}`
                );
            }
        }
    }
    const count = (v: Verdict): number => results.filter((r) => r.verdict === v).length;
    const info = count('info') ? `, ${count('info')} info` : '';
    const errors = count('error') ? `, ${count('error')} could not run` : '';
    lines.push(
        '',
        `${count('fail')} failed, ${count('warn')} warned, ${count('pass')} passed, ${count('skip')} skipped${info}${errors}`
    );
    return lines.join('\n') + '\n';
}
