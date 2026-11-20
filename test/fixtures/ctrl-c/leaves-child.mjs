// Dies on Ctrl-C, but its child ignores SIGINT and shares its output, so the
// child keeps running and holds stdout open after the program has exited.
import { spawn } from 'node:child_process';

spawn(
    process.execPath,
    ['-e', 'process.on("SIGINT", () => {}); setInterval(() => {}, 1000) // ctrl-c-orphan'],
    {
        stdio: 'inherit',
    }
);
console.log('up');
setInterval(() => {}, 1000);
