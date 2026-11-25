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

/** The widest invocation column; a longer invocation gets its reason on the next line. */
export const INVOCATION_COLUMN = 40;
/** The most evidence shown per result; --json has all of it. */
export const EVIDENCE_LIMIT = 200;
const CUT = ' ... (--json has the rest)';

/**
 * Evidence for one line of the report: escaped as safe() does, with a backslash from
 * the program doubled, so the text `\x1b` can't pass for a real escape. Past the limit
 * it ends at a word, or between two escapes, never inside one, and says it was cut.
 */
export function showEvidence(evidence: string, limit: number = EVIDENCE_LIMIT): string {
    const pieces = Array.from(evidence, (c) => (c === '\\' ? '\\\\' : safe(c)));
    let shown = '';
    let wordEnd = 0;
    for (const piece of pieces) {
        if (shown.length + piece.length > limit) {
            // A word boundary late enough to keep most of the text, or else a hard cut.
            const kept = wordEnd > limit * 0.6 ? shown.slice(0, wordEnd) : shown;
            return kept + CUT;
        }
        if (piece === ' ') wordEnd = shown.length;
        shown += piece;
    }
    return shown;
}

export function formatHuman(
    { version, command, checks, strict, results }: Report,
    { color }: RenderOptions
): string {
    const paint = (verdict: Verdict): string => {
        const label = verdict.toUpperCase().padEnd(5);
        return color ? `\x1b[${COLORS[verdict]}m${label}\x1b[0m` : label;
    };
    const shownInvocation = (invocation: readonly string[]): string => safe(shellJoin(invocation));
    const width = Math.max(
        0,
        ...results
            .map((r) => shownInvocation(r.invocation).length)
            .filter((length) => length <= INVOCATION_COLUMN)
    );
    const indent = `  ${' '.repeat(5)}  ${' '.repeat(width)}  `;
    const noun = checks.length === 1 ? 'check' : 'checks';
    const lines = [`cliprobe ${version}: ${checks.join(', ')} ${noun} for ${safe(command)}`];
    for (const check of checks) {
        lines.push('');
        // With several checks, each gets its own heading; with one, the title says it all.
        if (checks.length > 1) lines.push(check);
        for (const r of results.filter((result) => result.check === check)) {
            const invocation = shownInvocation(r.invocation);
            if (invocation.length > width) {
                // Too long for the column: padding every row to it would push each
                // reason far off an 80-column terminal.
                lines.push(`  ${paint(r.verdict)}  ${invocation}`, `${indent}${safe(r.reason)}`);
            } else {
                lines.push(`  ${paint(r.verdict)}  ${invocation.padEnd(width)}  ${safe(r.reason)}`);
            }
            if (r.evidence) lines.push(`${indent}${showEvidence(r.evidence)}`);
        }
    }
    lines.push('', summaryLine(countVerdicts(results), strict));
    return lines.join('\n') + '\n';
}
