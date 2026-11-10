// Prints the names as JSON: C0 controls are escaped, but C1 and bidi characters are not.
import { readdirSync } from 'node:fs';

console.log(JSON.stringify(readdirSync(process.argv[2])));
