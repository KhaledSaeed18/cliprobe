/** Characters a POSIX shell takes literally in a word; `{fixture}` stays readable. */
const PLAIN = /^[\w@%+=:,./{}-]+$/;

/**
 * Joins a command and its arguments the way you would type them in a shell,
 * single-quoting any argument with spaces, quotes or other special characters,
 * so `python3 -c 'import time; time.sleep(30)'` doesn't read as five words.
 * Only for display: cliprobe never runs a shell.
 */
export function shellJoin(args: readonly string[]): string {
    return args.map((a) => (PLAIN.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`)).join(' ');
}
