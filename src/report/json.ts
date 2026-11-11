import { safeJson } from '../core/safe.ts';
import type { Report } from './types.ts';

export function formatJson({ version, command, checks, results }: Report): string {
    return safeJson({ tool: 'cliprobe', version, command, checks, results }) + '\n';
}
