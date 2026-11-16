// Starts a child (a dev server, say) sharing its output, then dies on SIGTERM
// without stopping it, so the child keeps running and holds the pipes open.
import { spawn } from 'node:child_process';

spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // sigterm-orphan'], {
    stdio: 'inherit',
});
setInterval(() => {}, 1000);
