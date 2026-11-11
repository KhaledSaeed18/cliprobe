// Draws a spinner on stderr whether or not it is a terminal, then prints a result.
const frames = ['-', '\\', '|', '/'];
for (const frame of frames) process.stderr.write(`\r\x1b[2K${frame} working`);
process.stderr.write('\r\x1b[2K');
process.stdout.write('done\n');
