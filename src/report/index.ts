import { formatHuman } from './human.ts';
import { formatJson } from './json.ts';
import { formatMarkdown } from './markdown.ts';
import type { Formatter } from './types.ts';

/** The names --format takes. */
export type Format = 'human' | 'json' | 'markdown';

/** The format names, in the order --help lists them. */
export const FORMAT_NAMES: readonly Format[] = ['human', 'json', 'markdown'];

export function isFormat(name: string): name is Format {
    return (FORMAT_NAMES as readonly string[]).includes(name);
}

/** Every output format; the Record type makes a missing formatter a type error. */
export const FORMATS: Readonly<Record<Format, Formatter>> = {
    human: formatHuman,
    json: formatJson,
    markdown: formatMarkdown,
};

export type { Formatter, RenderOptions, Report } from './types.ts';
