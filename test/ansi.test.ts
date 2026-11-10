import { describe, expect, it } from 'vitest';
import { findStyle } from '../src/core/ansi.ts';

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
