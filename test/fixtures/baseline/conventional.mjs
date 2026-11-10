// Follows the conventions: one version line, help on stdout, a bad flag exits 2 on stderr.
const arg = process.argv[2];
if (arg === '--version') process.stdout.write('1.2.3\n');
else if (arg === '--help') process.stdout.write('Usage: tool [options]\n\nOptions:\n  --help\n');
else {
    process.stderr.write(`tool: unknown option ${arg}\n`);
    process.exitCode = 2;
}
