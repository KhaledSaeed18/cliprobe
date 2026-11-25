// A full-screen view in raw mode that dies by SIGKILL on the Ctrl-C key, so
// Node never gets to switch the terminal back out of raw mode, as a crash would.
process.stdin.setRawMode(true);
process.stdout.write('dashboard\r\n');
process.stdin.on('data', (key) => {
    if (key.includes(3)) process.kill(process.pid, 'SIGKILL');
});
