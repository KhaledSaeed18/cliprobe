import { safeJson } from '../core/safe.ts';
import { countVerdicts } from './summary.ts';
import type { Report } from './types.ts';

/**
 * Version of the JSON report's shape, described by `schema.json` in the package.
 * It changes only with a major release of cliprobe.
 */
export const SCHEMA_VERSION = 1;

/**
 * The report as JSON. Each result keeps the fields every check shares at the top
 * and moves the check's own measurements into `details`.
 */
export function formatJson({ version, command, checks, strict, results }: Report): string {
    return (
        safeJson({
            tool: 'cliprobe',
            schemaVersion: SCHEMA_VERSION,
            version,
            command,
            checks,
            strict,
            summary: countVerdicts(results),
            results: results.map(
                ({ check, invocation, verdict, reason, evidence, ...details }) => ({
                    check,
                    invocation,
                    verdict,
                    reason,
                    ...(evidence === undefined ? {} : { evidence }),
                    details,
                })
            ),
        }) + '\n'
    );
}
