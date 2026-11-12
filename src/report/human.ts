import { shellJoin } from '../core/quote.ts';
import { safe } from '../core/safe.ts';
import type { Verdict } from '../core/types.ts';
import { countVerdicts, summaryLine } from './summary.ts';
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
    const width = Math.max(0, ...results.map((r) => safe(shellJoin(r.invocation)).length));
    const noun = checks.length === 1 ? 'check' : 'checks';
    const lines = [`cliprobe ${version}: ${checks.join(', ')} ${noun} for ${safe(command)}`];
    for (const check of checks) {
        lines.push('');
        // With several checks, each gets its own heading; with one, the title says it all.
        if (checks.length > 1) lines.push(check);
        for (const r of results.filter((result) => result.check === check)) {
            lines.push(
                `  ${paint(r.verdict)}  ${safe(shellJoin(r.invocation)).padEnd(width)}  ${r.reason}`
            );
            if (r.evidence) {
                lines.push(
                    `  ${' '.repeat(5)}  ${' '.repeat(width)}  ${safe(r.evidence).slice(0, 200)}`
                );
            }
        }
    }
    lines.push('', summaryLine(countVerdicts(results)));
    return lines.join('\n') + '\n';
}
