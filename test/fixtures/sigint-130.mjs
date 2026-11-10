// Waits until SIGINT, writes a line to stderr before and after it, then exits 130.
process.stderr.write('before\n');
process.on('SIGINT', () => {
    process.stderr.write('after\n');
    process.exit(130);
});
setInterval(() => {}, 1000);
