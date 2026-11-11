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

/** JUnit's count attributes for a suite or the whole run. */
function totals(results: readonly Result[]): string {
    const c = countVerdicts(results);
    return `tests="${results.length}" failures="${c.fail}" errors="${c.error}" skipped="${c.skip}"`;
}

function testcase(r: Result): string {
    const open = `    <testcase classname="cliprobe.${xml(r.check)}" name="${xml(r.invocation.join(' '))}"`;
    const message = `message="${xml(r.reason)}"`;
    const body = r.evidence ? xml(r.evidence) : '';
    switch (r.verdict) {
        case 'fail':
            return `${open}>\n      <failure ${message} type="fail">${body}</failure>\n    </testcase>`;
        case 'error':
            return `${open}>\n      <error ${message} type="error">${body}</error>\n    </testcase>`;
        case 'skip':
            return `${open}>\n      <skipped ${message}/>\n    </testcase>`;
        case 'pass':
        case 'warn':
        case 'info': {
            // JUnit has no warning or info outcome: these pass, with the verdict kept in the output.
            const out = `${r.verdict.toUpperCase()}: ${xml(r.reason)}${r.evidence ? `\n${body}` : ''}`;
            return `${open}>\n      <system-out>${out}</system-out>\n    </testcase>`;
        }
    }
}

/** JUnit XML: one testsuite per check, one testcase per result. */
export function formatJunit({ version, command, checks, results }: Report): string {
    const suites = checks.map((check) => {
        const own = results.filter((r) => r.check === check);
        return [
            `  <testsuite name="${xml(check)}" ${totals(own)}>`,
            ...own.map(testcase),
            '  </testsuite>',
        ].join('\n');
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<testsuites name="cliprobe ${xml(version)}: ${xml(command)}" ${totals(results)}>`,
        ...suites,
        '</testsuites>',
        '',
    ].join('\n');
}
