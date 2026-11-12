// Hides the cursor and ignores Ctrl-C.
process.stdout.write('\x1b[?25l');
process.on('SIGINT', () => {});
setInterval(() => {}, 1000);
