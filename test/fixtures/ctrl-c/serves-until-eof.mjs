// Serves until stdin closes, as esbuild --serve does, and leaves Ctrl-C to Node's default.
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
setInterval(() => {}, 1000);
