// Writes its first argument to the file named by its second, then prints "ok".
import { writeFileSync } from 'node:fs';

writeFileSync(process.argv[3], process.argv[2]);
process.stdout.write('ok\n');
