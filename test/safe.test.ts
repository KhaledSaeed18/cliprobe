import { describe, expect, it } from 'vitest';
import { safe, safeJson } from '../src/core/safe.ts';

describe('safe', () => {
    it('escapes C0, DEL and C1 controls as \\x', () => {
        expect(safe('a\x1b]0;t\x07b\x7f\u009b')).toBe('a\\x1b]0;t\\x07b\\x7f\\x9b');
    });

    it('escapes newline, carriage return and tab, so one field stays one line', () => {
        expect(safe('a\nb\rc\td')).toBe('a\\x0ab\\x0dc\\x09d');
    });

    it('escapes line separators and bidirectional overrides as \\u', () => {
        expect(safe('x\u2028y\u202etxt.exe\u2066')).toBe('x\\u2028y\\u202etxt.exe\\u2066');
    });

    it('leaves ordinary text, including non-Latin letters, alone', () => {
        expect(safe('héllo wörld — ✓ 日本')).toBe('héllo wörld — ✓ 日本');
    });
});

/** Characters that must never appear raw in our JSON (C0 except newline, C1, separators, bidi). */
// oxlint-disable-next-line no-control-regex -- checking for raw control characters
const RAW = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e]/;

describe('safeJson', () => {
    it('escapes what JSON.stringify leaves raw, and parses back to the same value', () => {
        const value = { name: 'c1-\u009b2J bidi-\u202etxt \u2028 esc-\x1b' };
        const text = safeJson(value);
        expect(text).not.toMatch(RAW);
        expect(text).toContain('\\u009b');
        expect(text).toContain('\\u202e');
        expect(text).toContain('\\u2028');
        expect(JSON.parse(text)).toEqual(value);
    });
});
