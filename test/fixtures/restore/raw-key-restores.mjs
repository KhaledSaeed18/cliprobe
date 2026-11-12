// A full-screen view in raw mode: Ctrl-C arrives as a key (0x03), not as
// SIGINT, and it restores the terminal before it quits.
process.stdout.write('\x1b[?1049h\x1b[?25ldashboard\n');
process.stdin.setRawMode(true);
process.stdin.on('data', (key) => {
    if (!key.includes(3)) return;
    process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.exit(130);
});
