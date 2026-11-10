// Prints the names with util.inspect (console.log of an array): escapes controls, not bidi.
import { readdirSync } from 'node:fs';

console.log(readdirSync(process.argv[2]));
