// Lists a directory, escaping C0 and C1 controls, DEL, line separators and bidi overrides.
import { readdirSync } from 'node:fs';

const unsafe = (code) =>
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069);

const escape = (name) =>
    Array.from({ length: name.length }, (_, i) => {
        const code = name.charCodeAt(i);
        return unsafe(code) ? `\\u${code.toString(16).padStart(4, '0')}` : name[i];
    }).join('');

for (const name of readdirSync(process.argv[2])) console.log(escape(name));
