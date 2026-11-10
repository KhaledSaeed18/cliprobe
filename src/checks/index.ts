import type { Check } from '../core/types.ts';
import { baselineCheck } from './baseline.ts';
import { closedPipeCheck } from './closed-pipe.ts';
import { colorCheck } from './color.ts';
import { controlCharsCheck } from './control-chars.ts';
import { ctrlCCheck } from './ctrl-c.ts';
import { startupCheck } from './startup.ts';

/** Every check, in the order they run and are reported. */
export const CHECKS: readonly Check[] = [
    closedPipeCheck,
    colorCheck,
    ctrlCCheck,
    controlCharsCheck,
    startupCheck,
    baselineCheck,
];

export interface Selection {
    checks: Check[];
    /** Names that match no check. */
    unknown: string[];
}

/**
 * Picks checks by name, keeping registry order. No names selects every check of
 * kind "check": info checks only run when named, because they never fail and
 * baseline sends a flag the user did not ask for.
 */
export function selectChecks(names: readonly string[]): Selection {
    if (names.length === 0) {
        return { checks: CHECKS.filter((c) => c.kind === 'check'), unknown: [] };
    }
    const known = new Set(CHECKS.map((c) => c.name));
    return {
        checks: CHECKS.filter((c) => names.includes(c.name)),
        unknown: [...new Set(names.filter((n) => !known.has(n)))],
    };
}
