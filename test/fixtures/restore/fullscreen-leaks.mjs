// A full-screen view with the mouse on, whose Ctrl-C handler forgets both.
process.stdout.write('\x1b[?1049h\x1b[?1000;1006h\x1b[2J\x1b[Hdashboard\n');
process.on('SIGINT', () => process.exit(130));
setInterval(() => {}, 1000);
