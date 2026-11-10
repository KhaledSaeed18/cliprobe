import { safeJson } from '../core/safe.ts';
import type { Result } from '../core/types.ts';

export function formatJson(
    version: string,
    command: string,
    checks: readonly string[],
    results: readonly Result[]
): string {
    return safeJson({ tool: 'cliprobe', version, command, checks, results }) + '\n';
}
