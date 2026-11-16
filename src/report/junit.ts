import { shellJoin } from '../core/quote.ts';
import { safe } from '../core/safe.ts';
import type { Result } from '../core/types.ts';
import { countVerdicts } from './summary.ts';
import type { Report } from './types.ts';

const XML_ESCAPES: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
};

/**
 * Text that is always well-formed XML 1.0: safe() first turns every control
 * character (most of which XML forbids even when escaped) into a visible escape,
 * then the five markup characters become entities.
 */
export function xml(text: string): string {
    return safe(text).replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** JUnit's count attributes for a suite or the whole run; with --strict, warnings are failures. */
function totals(results: readonly Result[], strict: boolean): string {
    const c = countVerdicts(results);
    const failures = c.fail + (strict ? c.warn : 0);
    return `tests="${results.length}" failures="${failures}" errors="${c.error}" skipped="${c.skip}"`;
}

function testcase(r: Result, strict: boolean): string {
    const open = `    <testcase classname="cliprobe.${xml(r.check)}" name="${xml(shellJoin(r.invocation))}"`;
    const message = `message="${xml(r.reason)}"`;
    const body = r.evidence ? xml(r.evidence) : '';
    const failure = (type: string): string =>
        `${open}>\n      <failure ${message} type="${type}">${body}</failure>\n    </testcase>`;
    if (r.verdict === 'fail' || (strict && r.verdict === 'warn')) return failure(r.verdict);
    if (r.verdict === 'error') {
        return `${open}>\n      <error ${message} type="error">${body}</error>\n    </testcase>`;
    }
    if (r.verdict === 'skip') return `${open}>\n      <skipped ${message}/>\n    </testcase>`;
    // JUnit has no warning or info outcome: these pass, with the verdict kept in the output.
    const out = `${r.verdict.toUpperCase()}: ${xml(r.reason)}${r.evidence ? `\n${body}` : ''}`;
    return `${open}>\n      <system-out>${out}</system-out>\n    </testcase>`;
}

/** JUnit XML: one testsuite per check, one testcase per result. */
export function formatJunit({ version, command, checks, strict, results }: Report): string {
    const suites = checks.map((check) => {
        const own = results.filter((r) => r.check === check);
        return [
            `  <testsuite name="${xml(check)}" ${totals(own, strict)}>`,
            ...own.map((r) => testcase(r, strict)),
            '  </testsuite>',
        ].join('\n');
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<testsuites name="cliprobe ${xml(version)}: ${xml(command)}" ${totals(results, strict)}>`,
        ...suites,
        '</testsuites>',
        '',
    ].join('\n');
}
