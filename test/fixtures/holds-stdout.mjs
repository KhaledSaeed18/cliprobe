// Prints and exits at once, but leaves a child that shares its stdout and never exits.
import { spawn } from 'node:child_process';

spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // holds-stdout'], {
    stdio: 'inherit',
}).unref();
console.log('parent done');
