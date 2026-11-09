// Prints its PID, ignores SIGHUP and never exits: it would outlive script(1).
process.on('SIGHUP', () => {});
process.stdout.write(`pid ${process.pid}\n`);
setInterval(() => {}, 1000);
