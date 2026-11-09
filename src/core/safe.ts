// C0 and C1 control characters except tab and newline.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Escapes control characters so a target's output cannot drive our terminal. */
export function safe(text: string): string {
    return text.replace(CONTROL, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
