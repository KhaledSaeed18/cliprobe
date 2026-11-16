// Swallows SIGTERM and keeps running.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
