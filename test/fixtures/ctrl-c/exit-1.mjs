// Exits 1 on Ctrl-C: not the convention, but a script still sees a failure.
process.on('SIGINT', () => process.exit(1));
setInterval(() => {}, 1000);
