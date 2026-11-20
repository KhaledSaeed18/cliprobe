// Starts a child in its own session and process group, as Node's `detached`,
// setsid and daemons do, then dies on SIGTERM without stopping it.
import { spawn } from 'node:child_process';

spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // sigterm-detached'], {
    stdio: 'ignore',
    detached: true,
}).unref();
console.log('up');
setInterval(() => {}, 1000);
