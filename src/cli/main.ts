#!/usr/bin/env node
// cliprobe: black-box tests a command-line program for terminal-edge bugs.
import { run } from './program.ts';

// cliprobe practises what it checks: a closed stdout ends it quietly.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
});

process.exitCode = await run(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    color: process.stdout.isTTY && !process.env['NO_COLOR'],
    platform: process.platform,
});
