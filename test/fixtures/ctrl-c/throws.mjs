// Its Ctrl-C handler throws, so Node prints a stack trace.
process.on('SIGINT', () => {
    throw new Error('interrupted');
});
setInterval(() => {}, 1000);
