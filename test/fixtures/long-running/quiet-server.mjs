// A server that logs once, ignores write errors, and never exits.
process.stdout.on('error', () => {});
process.stdout.write('listening on :3000\n');
setInterval(() => {}, 1000);
