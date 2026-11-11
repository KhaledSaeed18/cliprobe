import { formatHuman } from './human.ts';
import { formatJson } from './json.ts';
import type { Formatter } from './types.ts';

/** The names --format takes. */
export type Format = 'human' | 'json';

/** Every output format; the Record type makes a missing formatter a type error. */
export const FORMATS: Readonly<Record<Format, Formatter>> = {
    human: formatHuman,
    json: formatJson,
};

export type { Formatter, RenderOptions, Report } from './types.ts';
