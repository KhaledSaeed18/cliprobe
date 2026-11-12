import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import type { Result } from '../src/core/types.ts';
import { code, formatMarkdown, prose } from '../src/report/markdown.ts';
import type { Report } from '../src/report/types.ts';
import { cliprobe, fixture } from './helpers/cli.ts';

const md = new MarkdownIt({ html: true });
const ESC = String.fromCharCode(0x1b);

const report = (results: Result[], command = 'tool'): Report => ({
    version: '9.9.9',
    command,
    checks: [...new Set(results.map((r) => r.check))],
    results,
});

/** The rendered table: one array of cell texts per body row. */
function rows(markdown: string): string[][] {
    const html = md.render(markdown);
    const body = html.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
    return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) =>
        [...(m[1] ?? '').matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1] ?? '')
    );
}

describe('markdown code spans', () => {
    it('fence past any backticks inside, padding when the text touches one', () => {
        expect(code('a`b', { inTable: false })).toBe('``a`b``');
        expect(code('`x`', { inTable: false })).toBe('`` `x` ``');
        expect(md.renderInline(code('a``b`', { inTable: false }))).toBe('<code>a``b`</code>');
    });

    it('escape pipes only inside tables', () => {
        expect(code('a|b', { inTable: true })).toBe('`a\\|b`');
        expect(code('a|b', { inTable: false })).toBe('`a|b`');
    });

    it('show control characters as escapes', () => {
        expect(code(`x${ESC}[2Jy`, { inTable: false })).toBe('`x\\x1b[2Jy`');
    });
});

describe('markdown prose', () => {
    it('neutralizes HTML, emphasis and links but keeps ordinary punctuation readable', () => {
        const html = md.renderInline(
            prose('<img src=x onerror=alert(1)> *bold* [l](u) e.g. a-b (c)')
        );
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<em>');
        expect(html).not.toContain('<a ');
        expect(html).toContain('e.g. a-b (c)');
    });
});

describe('formatMarkdown', () => {
    it('keeps one row of four cells per result, however hostile the text', () => {
        const hostile: Result = {
            check: 'closed-pipe',
            invocation: ['tool', 'a|b', '`tick`', `${ESC}]0;title\u0007`],
            verdict: 'fail',
            reason: 'could not start: /bin/x|y <script>alert(1)</script>',
            evidence: 'Error: ``bad`` | <b>bold</b>',
        };
        const { evidence: _evidence, ...noEvidence } = hostile;
        const out = formatMarkdown(report([hostile, { ...noEvidence, verdict: 'pass' }]));
        const table = rows(out);
        expect(table).toHaveLength(2);
        expect(table.every((cells) => cells.length === 4)).toBe(true);
        const html = md.render(out);
        expect(html).not.toMatch(/<script|<b>/);
        expect(html).not.toContain(ESC);
        expect(table[0]?.[2]).toBe("<code>tool 'a|b' '`tick`' '\\x1b]0;title\\x07'</code>");
        expect(table[0]?.[3]).toContain('<code>Error: ``bad`` | &lt;b&gt;bold&lt;/b&gt;</code>');
    });

    it('bolds failures and could-not-run, and leads with the summary line', () => {
        const out = formatMarkdown(
            report([
                { check: 'c', invocation: ['t'], verdict: 'fail', reason: 'r' },
                { check: 'c', invocation: ['t'], verdict: 'skip', reason: 'r' },
            ])
        );
        expect(out).toContain('## cliprobe 9.9.9: `tool`');
        expect(out).toContain('1 failed, 0 warned, 0 passed, 1 skipped');
        expect(rows(out).map((cells) => cells[1])).toEqual(['<strong>FAIL</strong>', 'SKIP']);
    });

    it('is what --format markdown prints, with the usual exit code', async () => {
        const r = await cliprobe([
            '--format',
            'markdown',
            '--check',
            'closed-pipe',
            '--',
            process.execPath,
            fixture('crash'),
        ]);
        expect(r.status).toBe(1);
        expect(r.stdout).toMatch(/^## cliprobe \d+\.\d+\.\d+: `/);
        expect(rows(r.stdout)[0]?.[1]).toBe('<strong>FAIL</strong>');
        expect(rows(r.stdout)[0]?.[3]).toContain('<code>Error: write EPIPE');
    });
});
