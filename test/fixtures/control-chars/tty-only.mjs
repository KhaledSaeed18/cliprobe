// Like ls: escapes control characters on a terminal, prints names exactly into a pipe.
import { readdirSync } from 'node:fs';

const escape = (name) =>
    Array.from({ length: name.length }, (_, i) => {
        const code = name.charCodeAt(i);
        const unsafe =
            code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x202a && code <= 0x202e);
        return unsafe ? '?' : name[i];
    }).join('');

for (const name of readdirSync(process.argv[2])) {
    console.log(process.stdout.isTTY ? escape(name) : name);
}
