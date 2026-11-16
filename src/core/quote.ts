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

/**
 * Splits `text` into arguments the way a POSIX shell splits a command line:
 * on unquoted whitespace, with '...' taken literally, "..." honoring \" \\ \$ \`,
 * and a backslash escaping the next character. Nothing is expanded: no
 * variables, wildcards or ~. Throws on an unclosed quote or a trailing backslash.
 */
export function shellSplit(text: string): string[] {
    const words: string[] = [];
    let word = '';
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charAt(i);
        if (c === "'") {
            const end = text.indexOf("'", i + 1);
            if (end < 0) throw new Error('has an unclosed single quote');
            word += text.slice(i + 1, end);
            inWord = true;
            i = end;
        } else if (c === '"') {
            inWord = true;
            for (i++; ; i++) {
                if (i >= text.length) throw new Error('has an unclosed double quote');
                const d = text.charAt(i);
                if (d === '"') break;
                const next = text.charAt(i + 1);
                if (d === '\\' && next !== '' && '"\\$`\n'.includes(next)) {
                    i++;
                    if (next !== '\n') word += next;
                } else word += d;
            }
        } else if (c === '\\') {
            if (i + 1 >= text.length) throw new Error('ends with a backslash');
            i++;
            // A backslash before a newline joins the lines, as in a shell.
            if (text.charAt(i) !== '\n') {
                word += text.charAt(i);
                inWord = true;
            }
        } else if (c === ' ' || c === '\t' || c === '\n') {
            if (inWord) words.push(word);
            word = '';
            inWord = false;
        } else {
            word += c;
            inWord = true;
        }
    }
    if (inWord) words.push(word);
    return words;
}
