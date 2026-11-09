import type { Check } from '../core/types.ts';
import { closedPipeCheck } from './closed-pipe.ts';

/** Every check, in the order they run and are reported. */
export const CHECKS: readonly Check[] = [closedPipeCheck];
