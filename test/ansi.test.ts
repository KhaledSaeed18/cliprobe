import { describe, expect, it } from 'vitest';
import { findControls, findOpenModes, findStyle, stripEscapes } from '../src/core/ansi.ts';

describe('findStyle', () => {
    it('finds basic, bright, 256-color and truecolor codes', () => {
        for (const seq of ['\x1b[31m', '\x1b[1;91m', '\x1b[38;5;196m', '\x1b[38:2::255:0:0m']) {
            expect(findStyle(`plain ${seq}x\x1b[0m`)?.sequence).toBe(seq);
        }
    });

    it('counts bold and underline as styling', () => {
        expect(findStyle('\x1b[1mbold\x1b[22m')?.sequence).toBe('\x1b[1m');
        expect(findStyle('\x1b[4mline\x1b[24m')?.sequence).toBe('\x1b[4m');
    });

    it('ignores pure resets', () => {
        expect(findStyle('a\x1b[0mb\x1b[mc\x1b[39;49md\x1b[22m')).toBeUndefined();
    });

    it('treats a reset combined with a color as styling', () => {
        expect(findStyle('\x1b[0;32mok')?.sequence).toBe('\x1b[0;32m');
    });

    it('ignores plain text and non-SGR escape sequences', () => {
        expect(findStyle('no color here\n')).toBeUndefined();
        expect(findStyle('\x1b[2K\x1b[1G\x1b[?25l')).toBeUndefined();
    });

    it('reports the line number and the line', () => {
        expect(findStyle('one\ntwo \x1b[33mwarn\x1b[0m\nthree')).toEqual({
            sequence: '\x1b[33m',
            line: 2,
            text: 'two \x1b[33mwarn\x1b[0m',
        });
    });
});

describe('findControls', () => {
    const kinds = (text: string): string[] => findControls(text).map((h) => h.kind);

    it('finds cursor movement, erases and mode switches', () => {
        expect(kinds('\x1b[1G\x1b[2A\x1b[10;5H')).toEqual(['cursor', 'cursor', 'cursor']);
        expect(kinds('\x1b[2K\x1b[J')).toEqual(['erase', 'erase']);
        expect(kinds('\x1b[?25l\x1b[?25h\x1b[?2004h')).toEqual(['mode', 'mode', 'mode']);
    });

    it('finds hyperlinks, window titles and other OSC codes, ended by BEL or ST', () => {
        expect(kinds('\x1b]8;;https://x.dev\x07link\x1b]8;;\x07')).toEqual([
            'hyperlink',
            'hyperlink',
        ]);
        expect(kinds('\x1b]0;my title\x1b\\')).toEqual(['title']);
        expect(kinds('\x1b]52;c;aGk=\x07')).toEqual(['osc']);
    });

    it('treats a carriage return that redraws a line as a redraw, but not CRLF', () => {
        expect(kinds('working |\rworking /\rdone\n')).toEqual(['redraw', 'redraw']);
        expect(kinds('line one\r\nline two\r\n')).toEqual([]);
    });

    it('leaves color and style to the color check', () => {
        expect(kinds('\x1b[31mred\x1b[0m \x1b[1mbold\x1b[22m')).toEqual([]);
    });

    it('lists hits in reading order with their line', () => {
        const hits = findControls('plain\n\x1b]0;t\x07 \x1b[2K\rx');
        expect(hits.map((h) => h.kind)).toEqual(['title', 'erase', 'redraw']);
        expect(hits[0]).toMatchObject({ line: 2, sequence: '\x1b]0;t\x07' });
    });

    it('finds nothing in plain text', () => {
        expect(findControls('just text\nand more\n')).toEqual([]);
    });
});

describe('stripEscapes', () => {
    it('removes color, cursor and OSC codes but keeps the text and line breaks', () => {
        expect(
            stripEscapes('\x1b[31mred\x1b[0m \x1b[2Kline\n\x1b]8;;https://x\x07link\x1b]8;;\x07')
        ).toBe('red line\nlink');
    });

    it('keeps carriage returns, which callers look at', () => {
        expect(stripEscapes('\r- working')).toBe('\r- working');
    });
});

describe('findOpenModes', () => {
    const labels = (text: string): string[] => findOpenModes(text).map((m) => m.label);

    it('finds a hidden cursor that is never shown again', () => {
        expect(findOpenModes('a\n\x1b[?25lspinning')).toEqual([
            { label: 'hidden cursor', sequence: '\x1b[?25l', line: 2 },
        ]);
    });

    it('leaves out modes that were switched back off', () => {
        expect(labels('\x1b[?1049h\x1b[?25l…\x1b[?25h\x1b[?1049l')).toEqual([]);
        expect(labels('\x1b[?7l…\x1b[?7h')).toEqual([]);
    });

    it('reads several modes in one sequence', () => {
        expect(labels('\x1b[?1000;1006h\x1b[?2004h\x1b[?1004h')).toEqual([
            'mouse reporting',
            'bracketed paste',
            'focus reporting',
        ]);
    });

    it('keeps the first switch-on as the evidence when a mode is switched on twice', () => {
        expect(findOpenModes('\x1b[?25l\n\x1b[?25l')[0]?.line).toBe(1);
    });

    it('treats a full reset (ESC c) as restoring everything', () => {
        expect(labels('\x1b[?25l\x1b[?1049h\x1bc')).toEqual([]);
        expect(labels('\x1bc\x1b[?47h')).toEqual(['alternate screen']);
    });

    it('ignores modes that do not break a shell, and a shown cursor', () => {
        expect(labels('\x1b[?1h\x1b[?12h\x1b[?25h\x1b[?7h')).toEqual([]);
    });
});
