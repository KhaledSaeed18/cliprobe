import { shellJoin } from '../core/quote.ts';
import { safe } from '../core/safe.ts';
import type { Result } from '../core/types.ts';
import { countVerdicts, summaryLine } from './summary.ts';
import type { Report } from './types.ts';

/**
 * A code span that shows any text literally: control characters escaped onto one
 * line, `|` escaped so a table cell can't be split, and a fence longer than any
 * run of backticks inside.
 */
export function code(text: string, { inTable }: { inTable: boolean }): string {
    const body = inTable ? safe(text).replaceAll('|', '\\|') : safe(text);
    const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(longest + 1);
    const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${body}${pad}${fence}`;
}

/**
 * Prose for inside a table cell. Only characters that act mid-line are escaped:
 * emphasis, code, links, HTML, entities and the cell separator. Line-start syntax
 * (`#`, `-`, `1.`) can't trigger there, so it stays readable.
 */
export function prose(text: string): string {
    return safe(text).replace(/[\\`*_[\]<>|~&]/g, (c) => `\\${c}`);
}

function row(r: Result): string {
    const verdict =
        r.verdict === 'fail' || r.verdict === 'error'
            ? `**${r.verdict.toUpperCase()}**`
            : r.verdict.toUpperCase();
    const evidence = r.evidence ? `<br>${code(r.evidence.slice(0, 300), { inTable: true })}` : '';
    const cells = [
        prose(r.check),
        verdict,
        code(shellJoin(r.invocation), { inTable: true }),
        prose(r.reason) + evidence,
    ];
    return `| ${cells.join(' | ')} |`;
}

/** GitHub-flavored Markdown, for a job summary ($GITHUB_STEP_SUMMARY) or a PR comment. */
export function formatMarkdown({ version, command, results }: Report): string {
    return [
        `## cliprobe ${version}: ${code(command, { inTable: false })}`,
        '',
        summaryLine(countVerdicts(results)),
        '',
        '| Check | Verdict | Invocation | Result |',
        '| --- | --- | --- | --- |',
        ...results.map(row),
        '',
    ].join('\n');
}
