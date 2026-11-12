// A watcher: lists a directory raw, as console.log does, then keeps running.
import { readdirSync } from 'node:fs';

for (const name of readdirSync(process.argv[2])) console.log(name);
setInterval(() => {}, 1000);
