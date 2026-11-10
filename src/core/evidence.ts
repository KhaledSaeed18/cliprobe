/** Signs that a program reported a write failure or crashed with a stack trace. */
export const ERROR_RE: RegExp =
    /EPIPE|broken ?pipe|BrokenPipeError|Unhandled 'error' event|^\s+at .+:\d+:\d+\)?$/im;

/** Signs of a stack trace from Node, Python, Go or Rust. */
export const TRACE_RE: RegExp =
    /Traceback \(most recent call last\)|^\s+at .+:\d+:\d+\)?$|^panic: |^goroutine \d+ \[|thread '.+' panicked/m;

/** Lines worth quoting as the error message, best first. */
const CRASH_MESSAGES: readonly RegExp[] = [/^(\w*Error\b|panic:)/, ERROR_RE];

/**
 * Picks the most useful evidence from a crash: the error message plus the first
 * stack frame in the program's own code (not Node internals), which usually
 * points at the faulty line. `messages` ranks the patterns for the message line.
 */
export function crashEvidence(
    stderr: string,
    messages: readonly RegExp[] = CRASH_MESSAGES
): string {
    const lines = stderr
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    let message = '';
    for (const pattern of messages) {
        message = lines.find((l) => pattern.test(l)) ?? '';
        if (message) break;
    }
    message ||= lines[0] ?? '';
    const frame = lines
        .find((l) => l.startsWith('at ') && !/\bnode:/.test(l))
        ?.match(/(?:file:\/\/)?(\/[^\s()]+:\d+:\d+)/)?.[1];
    if (!frame) return message;
    const cwd = process.cwd() + '/';
    return `${message} (at ${frame.startsWith(cwd) ? frame.slice(cwd.length) : frame})`;
}
