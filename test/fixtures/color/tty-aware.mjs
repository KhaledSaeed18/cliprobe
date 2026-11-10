// Colors only when stdout is a terminal and NO_COLOR is unset: the behavior to aim for.
const color = process.stdout.isTTY && !process.env.NO_COLOR;
process.stdout.write(color ? '\x1b[32mok\x1b[0m\n' : 'ok\n');
