// Hides the cursor for a spinner and dies on Ctrl-C without showing it again.
process.stdout.write('\x1b[?25l');
setInterval(() => process.stdout.write('\r-'), 100);
