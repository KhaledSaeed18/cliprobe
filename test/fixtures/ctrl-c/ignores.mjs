// Swallows Ctrl-C and keeps running.
process.on('SIGINT', () => {});
setInterval(() => {}, 1000);
