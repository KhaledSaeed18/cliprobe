// Lists a directory with console.log, printing each name exactly as it is.
import { readdirSync } from 'node:fs';

for (const name of readdirSync(process.argv[2])) console.log(name);
