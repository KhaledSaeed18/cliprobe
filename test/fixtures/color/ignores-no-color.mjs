// Colors in a terminal but ignores NO_COLOR.
process.stdout.write(process.stdout.isTTY ? '\x1b[32mok\x1b[0m\n' : 'ok\n');
