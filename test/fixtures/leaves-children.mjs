// Starts one child in its process group and one in a session of its own, both
// with their output elsewhere, then exits while they keep running.
import { spawn } from 'node:child_process';

spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // run-orphan'], {
    stdio: 'ignore',
}).unref();
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // run-detached'], {
    stdio: 'ignore',
    detached: true,
}).unref();
// Long enough for cliprobe to see the detached child while this one runs.
setTimeout(() => {}, 600);
