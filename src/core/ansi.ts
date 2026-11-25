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
/**
 * Every control code findControls() knows, as alternatives tried in this order at each
 * position, so one sequence is never counted twice:
 * - csi: ESC [ parameter bytes, intermediate bytes, one final byte;
 * - osc: ESC ] number ; text, ended by BEL or ESC ;
 * - oscOther: any other OSC, such as ESC ] 104 BEL (no ";");
 * - string: DCS, SOS, PM or APC (ESC P, X, ^ or _), with its text when ST ends it;
 * - reset: ESC c, a full reset that clears the screen;
 * - escape: any other ESC sequence: intermediates (ESC ( B) or one final byte (ESC 7);
 * - c1: an 8-bit CSI, OSC, DCS, SOS, PM or APC introducer, with what it carries;
 * - redraw: a carriage return that does not end a CRLF line: a line being redrawn.
 * ESC \ (ST) alone ends a string and starts nothing.
 */
const CONTROL = new RegExp(
    [
        String.raw`(?<csi>\x1b\[(?<params>[0-?]*)[ -/]*(?<final>[@-~]))`,
        String.raw`(?<osc>\x1b\](?<code>\d*);[^\x07\x1b]*(?:\x07|\x1b\\))`,
        String.raw`(?<oscOther>\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))`,
        String.raw`(?<string>\x1b[PX^_](?:[^\x1b]*\x1b\\)?)`,
        String.raw`(?<reset>\x1bc)`,
        String.raw`(?<escape>\x1b(?:[ -/]+[0-~]|[0-OQ-WYZ\x60-bd-~]))`,
        String.raw`(?<c1>\x9b[0-?]*[ -/]*[@-~]?|[\x90\x98\x9d\x9e\x9f][^\x07\x1b\x9c]*(?:\x07|\x9c|\x1b\\)?)`,
        String.raw`(?<redraw>\r(?!\n))`,
    ].join('|'),
    'g'
);
/* oxlint-enable no-control-regex */

export type ControlKind =
    | 'cursor'
    | 'erase'
    | 'mode'
    | 'hyperlink'
    | 'title'
    | 'osc'
    | 'redraw'
    | 'escape'
    | 'reset'
    | 'string'
    | 'c1';

/** How each kind reads in a report. */
export const CONTROL_LABELS: Readonly<Record<ControlKind, string>> = {
    cursor: 'cursor movement',
    erase: 'line or screen erase',
    mode: 'terminal mode switch (such as hiding the cursor)',
    hyperlink: 'hyperlink (OSC 8)',
    title: 'window title',
    osc: 'operating system command (OSC)',
    redraw: 'carriage-return redraw',
    escape: 'other escape sequence (such as saving the cursor or switching the character set)',
    reset: 'full terminal reset (ESC c)',
    string: 'device control string (DCS, APC, PM or SOS)',
    c1: '8-bit control sequence (C1)',
};

export interface ControlHit extends StyleHit {
    kind: ControlKind;
    /**
     * Found by a detection added in 1.5 (#42) and not yet calibrated against real tools,
     * so under the "no false fails" rule it may only warn.
     */
    warnOnly: boolean;
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

function hitAt(
    text: string,
    index: number,
    sequence: string,
    kind: ControlKind,
    warnOnly: boolean
): ControlHit {
    const before = text.slice(0, index);
    const start = before.lastIndexOf('\n') + 1;
    const newline = text.indexOf('\n', index);
    const end = newline === -1 ? text.length : newline;
    return {
        kind,
        sequence,
        line: before.split('\n').length,
        text: text.slice(start, end).slice(0, 120),
        warnOnly,
    };
}

/** The kind of one CONTROL match, and whether it may only warn; undefined for SGR. */
function classify(g: Record<string, string | undefined>): [ControlKind, boolean] | undefined {
    if (g['csi'] !== undefined) {
        const kind = csiKind(g['params'] ?? '', g['final'] ?? '');
        return kind && [kind, false];
    }
    if (g['osc'] !== undefined) return [oscKind(g['code'] ?? ''), false];
    if (g['redraw'] !== undefined) return ['redraw', false];
    if (g['oscOther'] !== undefined) return ['osc', true];
    if (g['string'] !== undefined) return ['string', true];
    if (g['reset'] !== undefined) return ['reset', true];
    if (g['escape'] !== undefined) return ['escape', true];
    return ['c1', true];
}

/**
 * Every terminal control code in the text other than color and style (SGR):
 * cursor movement, erases, mode switches, OSC sequences such as hyperlinks and
 * window titles, carriage returns that redraw a line, and (warn-only) the other
 * ESC sequences, control strings and 8-bit controls. In reading order.
 */
export function findControls(text: string): ControlHit[] {
    const hits: ControlHit[] = [];
    for (const m of text.matchAll(CONTROL)) {
        const found = classify(m.groups ?? {});
        if (found) hits.push(hitAt(text, m.index, m[0], ...found));
    }
    return hits;
}

// oxlint-disable-next-line no-control-regex -- matching terminal control codes is the point
const ANY_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** The text with CSI and OSC escape sequences (color, cursor, links, titles) removed. */
export function stripEscapes(text: string): string {
    return text.replace(ANY_ESCAPE, '');
}

/** A terminal mode a program can switch on and must switch back off before it exits. */
export interface TerminalMode {
    label: string;
    /** The DEC private mode numbers that control it. */
    codes: readonly number[];
    /** True when `h` (set) restores it and `l` (reset) changes it, as for the cursor. */
    inverted?: boolean;
}

/** The modes that leave a shell broken when a program forgets them. */
export const TERMINAL_MODES: readonly TerminalMode[] = [
    { label: 'hidden cursor', codes: [25], inverted: true },
    { label: 'alternate screen', codes: [47, 1047, 1049] },
    { label: 'mouse reporting', codes: [9, 1000, 1001, 1002, 1003, 1005, 1006, 1015] },
    { label: 'focus reporting', codes: [1004] },
    { label: 'bracketed paste', codes: [2004] },
    { label: 'line wrapping off', codes: [7], inverted: true },
];

export interface OpenMode {
    label: string;
    /** The sequence that switched it on, as printed. */
    sequence: string;
    /** 1-based line of that sequence. */
    line: number;
}

/** DEC private mode set or reset (ESC [ ? numbers h|l), or a full reset (ESC c). */
// oxlint-disable-next-line no-control-regex -- matching terminal control codes is the point
const DEC_MODE = /\x1b\[\?([\d;]+)([hl])|\x1bc/g;

/**
 * The terminal modes the text leaves switched on, in the order they were
 * switched on. A mode counts as on from its first switch-on until a later
 * switch-off or a full reset, so a program that restores everything leaves none.
 */
export function findOpenModes(text: string): OpenMode[] {
    const open = new Map<TerminalMode, OpenMode & { index: number }>();
    for (const m of text.matchAll(DEC_MODE)) {
        if (m[2] === undefined) {
            open.clear(); // ESC c resets the terminal, every mode with it
            continue;
        }
        const set = m[2] === 'h';
        for (const code of (m[1] ?? '').split(';').map(Number)) {
            const mode = TERMINAL_MODES.find((t) => t.codes.includes(code));
            if (!mode) continue;
            const on = mode.inverted ? !set : set;
            if (!on) open.delete(mode);
            else if (!open.has(mode)) {
                const line = text.slice(0, m.index).split('\n').length;
                open.set(mode, { label: mode.label, sequence: m[0], line, index: m.index });
            }
        }
    }
    return [...open.values()]
        .sort((a, b) => a.index - b.index)
        .map(({ label, sequence, line }) => ({ label, sequence, line }));
}
