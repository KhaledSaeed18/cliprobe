// Prompts only when stdin is a terminal; otherwise takes the default: the behavior to aim for.
if (process.stdin.isTTY) process.stdout.write('Proceed? (y/n) ');
else process.stdout.write('not a terminal: using the default (no)\n');
