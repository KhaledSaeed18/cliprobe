// Like orphans.mjs, but its two children don't share its output, so nothing
// holds the pipes open once it exits.
import { spawn } from 'node:child_process';

for (let i = 0; i < 2; i++) {
    spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // sigterm-orphan'], {
        stdio: 'ignore',
    });
}
setInterval(() => {}, 1000);
