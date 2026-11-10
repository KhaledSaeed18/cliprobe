// Cleans up on Ctrl-C and exits 130, the convention.
process.on('SIGINT', () => process.exit(130));
setInterval(() => {}, 1000);
