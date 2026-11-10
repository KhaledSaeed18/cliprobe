/* oxlint-disable no-control-regex -- matching control characters is the point */
/**
 * C0 and C1 controls, DEL, Unicode line separators and bidirectional overrides:
 * everything that can drive a terminal, forge a line, or reorder what is shown.
 */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** The same, minus C0, which JSON.stringify already escapes. */
const JSON_UNSAFE = /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/* oxlint-enable no-control-regex */

const hex = (c: string, width: number): string => c.charCodeAt(0).toString(16).padStart(width, '0');

/**
 * Escapes text from a target (its output, its arguments, file names) for one
 * line of our own report: `\x1b`, `\x0a`, `\u202e`. It can no longer drive the
 * terminal, break the line, or disguise itself.
 */
export function safe(text: string): string {
    return text.replace(UNSAFE, (c) =>
        c.charCodeAt(0) <= 0xff ? `\\x${hex(c, 2)}` : `\\u${hex(c, 4)}`
    );
}

/** JSON.stringify, plus \u escapes for the characters it leaves raw. Parses back identically. */
export function safeJson(value: unknown): string {
    return JSON.stringify(value, null, 2).replace(JSON_UNSAFE, (c) => `\\u${hex(c, 4)}`);
}
