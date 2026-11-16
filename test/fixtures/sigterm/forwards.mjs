// Starts a child and, on SIGTERM, stops it and waits for it before exiting.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'inherit',
});
process.on('SIGTERM', () => {
    child.on('exit', () => process.exit(0));
    child.kill('SIGTERM');
});
setInterval(() => {}, 1000);
