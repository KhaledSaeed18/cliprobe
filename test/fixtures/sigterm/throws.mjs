// Its SIGTERM handler throws, so Node prints a stack trace.
process.on('SIGTERM', () => {
    throw new Error('terminated');
});
setInterval(() => {}, 1000);
