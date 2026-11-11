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

/* oxlint-disable no-control-regex -- matching terminal control codes is the point */
/** CSI: ESC [ parameter bytes, intermediate bytes, one final byte. */
const CSI = /\x1b\[([0-?]*)[ -/]*([@-~])/g;
/** OSC: ESC ] number ; text, ended by BEL or ESC \. */
const OSC = /\x1b\](\d*);[^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** A carriage return that does not end a CRLF line: a line being redrawn. */
const BARE_CR = /\r(?!\n)/g;
/* oxlint-enable no-control-regex */

export type ControlKind = 'cursor' | 'erase' | 'mode' | 'hyperlink' | 'title' | 'osc' | 'redraw';

/** How each kind reads in a report. */
export const CONTROL_LABELS: Readonly<Record<ControlKind, string>> = {
    cursor: 'cursor movement',
    erase: 'line or screen erase',
    mode: 'terminal mode switch (such as hiding the cursor)',
    hyperlink: 'hyperlink (OSC 8)',
    title: 'window title',
    osc: 'operating system command (OSC)',
    redraw: 'carriage-return redraw',
};

export interface ControlHit extends StyleHit {
    kind: ControlKind;
}

function csiKind(params: string, final: string): ControlKind | undefined {
    if (final === 'm') return undefined; // SGR: color and style, the color check's job
    if (final === 'K' || final === 'J') return 'erase';
    if ((final === 'h' || final === 'l') && params.startsWith('?')) return 'mode';
    return 'cursor';
}

function oscKind(code: string): ControlKind {
    if (code === '8') return 'hyperlink';
    if (code === '0' || code === '1' || code === '2') return 'title';
    return 'osc';
}

function hitAt(text: string, index: number, sequence: string, kind: ControlKind): ControlHit {
    const before = text.slice(0, index);
    const start = before.lastIndexOf('\n') + 1;
    const newline = text.indexOf('\n', index);
    const end = newline === -1 ? text.length : newline;
    return {
        kind,
        sequence,
        line: before.split('\n').length,
        text: text.slice(start, end).slice(0, 120),
    };
}

/**
 * Every terminal control code in the text other than color and style (SGR):
 * cursor movement, erases, mode switches, OSC sequences such as hyperlinks and
 * window titles, and carriage returns that redraw a line. In reading order.
 */
export function findControls(text: string): ControlHit[] {
    const hits: { index: number; hit: ControlHit }[] = [];
    for (const m of text.matchAll(CSI)) {
        const kind = csiKind(m[1] ?? '', m[2] ?? '');
        if (kind) hits.push({ index: m.index, hit: hitAt(text, m.index, m[0], kind) });
    }
    for (const m of text.matchAll(OSC)) {
        hits.push({ index: m.index, hit: hitAt(text, m.index, m[0], oscKind(m[1] ?? '')) });
    }
    for (const m of text.matchAll(BARE_CR)) {
        hits.push({ index: m.index, hit: hitAt(text, m.index, m[0], 'redraw') });
    }
    return hits.sort((a, b) => a.index - b.index).map((h) => h.hit);
}

// oxlint-disable-next-line no-control-regex -- matching terminal control codes is the point
const ANY_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** The text with CSI and OSC escape sequences (color, cursor, links, titles) removed. */
export function stripEscapes(text: string): string {
    return text.replace(ANY_ESCAPE, '');
}
