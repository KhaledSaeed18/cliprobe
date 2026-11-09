/** Signs that a program reported a write failure or crashed with a stack trace. */
export const ERROR_RE: RegExp =
    /EPIPE|broken ?pipe|BrokenPipeError|Unhandled 'error' event|^\s+at .+:\d+:\d+\)?$/im;

/**
 * Picks the most useful evidence from a crash: the error message plus the first
 * stack frame in the program's own code (not Node internals), which usually
 * points at the unguarded write.
 */
export function crashEvidence(stderr: string): string {
    const lines = stderr
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const message =
        lines.find((l) => /^(\w*Error\b|panic:)/.test(l)) ??
        lines.find((l) => ERROR_RE.test(l)) ??
        lines[0] ??
        '';
    const frame = lines
        .find((l) => l.startsWith('at ') && !/\bnode:/.test(l))
        ?.match(/(?:file:\/\/)?(\/[^\s()]+:\d+:\d+)/)?.[1];
    if (!frame) return message;
    const cwd = process.cwd() + '/';
    return `${message} (at ${frame.startsWith(cwd) ? frame.slice(cwd.length) : frame})`;
}
