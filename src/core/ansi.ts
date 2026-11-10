// SGR ("select graphic rendition"): ESC [ params m, with ; or : between params.
// oxlint-disable-next-line no-control-regex -- matching escape sequences is the point
const SGR = /\x1b\[([0-9;:]*)m/g;

/** SGR params that only turn something off. A sequence made only of these is not styling. */
const RESETS = new Set([
    '',
    '0',
    '22',
    '23',
    '24',
    '25',
    '27',
    '28',
    '29',
    '39',
    '49',
    '54',
    '55',
    '59',
]);

export interface StyleHit {
    /** The escape sequence itself, e.g. "\x1b[31m". */
    sequence: string;
    /** 1-based line number in the text. */
    line: number;
    /** That line, cut to 120 characters. */
    text: string;
}

/**
 * Finds the first SGR sequence that sets a color or style (red, bold, 256-color,
 * truecolor...). Pure resets are ignored: some programs always print them, and
 * they change nothing on screen.
 */
export function findStyle(text: string): StyleHit | undefined {
    for (const match of text.matchAll(SGR)) {
        const params = (match[1] ?? '').split(/[;:]/);
        if (params.every((p) => RESETS.has(p))) continue;
        const before = text.slice(0, match.index);
        const start = before.lastIndexOf('\n') + 1;
        const newline = text.indexOf('\n', match.index);
        const end = newline === -1 ? text.length : newline;
        return {
            sequence: match[0],
            line: before.split('\n').length,
            text: text.slice(start, end).slice(0, 120),
        };
    }
    return undefined;
}
