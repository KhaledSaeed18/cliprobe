// Draws its spinner only when stderr is a terminal: the behavior to aim for.
if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K- working');
process.stdout.write('done\n');
