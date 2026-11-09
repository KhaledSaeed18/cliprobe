import type { Check } from '../core/types.ts';
import { closedPipeCheck } from './closed-pipe.ts';

/** Every check, in the order they run and are reported. */
export const CHECKS: readonly Check[] = [closedPipeCheck];

export interface Selection {
    checks: Check[];
    /** Names that match no check. */
    unknown: string[];
}

/** Picks checks by name, keeping registry order. No names selects every check. */
export function selectChecks(names: readonly string[]): Selection {
    if (names.length === 0) return { checks: [...CHECKS], unknown: [] };
    const known = new Set(CHECKS.map((c) => c.name));
    return {
        checks: CHECKS.filter((c) => names.includes(c.name)),
        unknown: [...new Set(names.filter((n) => !known.has(n)))],
    };
}
