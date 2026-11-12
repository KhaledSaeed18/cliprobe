// Lists a directory raw, as ls does into a pipe, then draws a spinner frame on stderr.
import { readdirSync } from 'node:fs';

for (const name of readdirSync(process.argv[2])) console.log(name);
process.stderr.write('\r-\rdone\n');
