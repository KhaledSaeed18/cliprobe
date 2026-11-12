// A full-screen view that switches everything back off on Ctrl-C.
process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?2004hdashboard\n');
process.on('SIGINT', () => {
    process.stdout.write('\x1b[?2004l\x1b[?25h\x1b[?1049l');
    process.exit(130);
});
setInterval(() => {}, 1000);
