// Cleans up on SIGTERM and exits 0, as a server that drains its connections does.
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 200));
setInterval(() => {}, 1000);
