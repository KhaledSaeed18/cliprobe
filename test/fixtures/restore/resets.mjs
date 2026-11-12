// Restores the terminal on Ctrl-C with a full reset (ESC c).
process.stdout.write('\x1b[?25l\x1b[?1049h');
process.on('SIGINT', () => {
    process.stdout.write('\x1bc');
    process.exit(130);
});
setInterval(() => {}, 1000);
