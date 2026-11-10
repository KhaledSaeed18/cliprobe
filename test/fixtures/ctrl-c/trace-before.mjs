// Prints a stack trace at startup (a warning), but handles Ctrl-C cleanly.
process.stderr.write('Warning: something\n    at main (/app/cli.js:10:5)\n');
process.on('SIGINT', () => process.exit(130));
setInterval(() => {}, 1000);
