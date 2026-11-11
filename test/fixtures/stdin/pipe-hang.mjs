// Hangs when stdin is a pipe, closed or not, and finishes on /dev/null: stdin is involved,
// but closing it doesn't end the hang, so the cause can't be proven.
import { fstatSync } from 'node:fs';

if (fstatSync(0).isFIFO() || fstatSync(0).isSocket()) setInterval(() => {}, 1000);
else process.stdout.write('done\n');
