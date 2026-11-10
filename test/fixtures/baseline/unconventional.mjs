// Breaks each convention: two version lines, help on stderr with exit 1, a bad flag exits 0.
const arg = process.argv[2];
if (arg === '--version') process.stdout.write('tool\nversion 1.2.3\n');
else if (arg === '--help') {
    process.stderr.write('Usage: tool [options]\n');
    process.exitCode = 1;
} else process.stdout.write(`unknown option ${arg}\n`);
