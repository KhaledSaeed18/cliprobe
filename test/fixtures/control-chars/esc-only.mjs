// Strips ESC from names but nothing else, so CR, newline and C1 still get through.
import { readdirSync } from 'node:fs';

const ESC = String.fromCharCode(0x1b);
for (const name of readdirSync(process.argv[2])) console.log(name.replaceAll(ESC, '\\e'));
