// Exits 0 on Ctrl-C, so a script thinks the work finished.
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1000);
