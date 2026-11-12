// A full-screen view in raw mode that quits on the Ctrl-C key without
// switching the alternate screen and the hidden cursor back off.
process.stdout.write('\x1b[?1049h\x1b[?25ldashboard\n');
process.stdin.setRawMode(true);
process.stdin.on('data', (key) => {
    if (key.includes(3)) process.exit(130);
});
