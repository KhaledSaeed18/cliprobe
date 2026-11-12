// Hides the cursor for a spinner and shows it again on Ctrl-C.
process.stdout.write('\x1b[?25l');
process.on('SIGINT', () => {
    process.stdout.write('\x1b[?25h\n');
    process.exit(130);
});
setInterval(() => process.stdout.write('\r-'), 100);
