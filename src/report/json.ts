import type { Result } from '../core/types.ts';

export function formatJson(version: string, command: string, results: readonly Result[]): string {
    return JSON.stringify({ tool: 'cliprobe', version, command, results }, null, 2) + '\n';
}
