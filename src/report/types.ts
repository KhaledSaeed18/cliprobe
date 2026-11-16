import type { Result } from '../core/types.ts';

/** Everything a reporter needs: one run of cliprobe against one command. */
export interface Report {
    version: string;
    command: string;
    /** The checks that ran, in order. */
    checks: readonly string[];
    /** --strict: warnings fail too. */
    strict: boolean;
    results: readonly Result[];
}

export interface RenderOptions {
    /** Color verdict labels; only human output uses it. */
    color: boolean;
}

/** Turns a report into the full text of one output format. */
export type Formatter = (report: Report, options: RenderOptions) => string;
