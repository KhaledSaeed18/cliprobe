// Cleans up on Ctrl-C, then re-raises SIGINT so its parent sees the real cause.
process.once('SIGINT', () => process.kill(process.pid, 'SIGINT'));
setInterval(() => {}, 1000);
