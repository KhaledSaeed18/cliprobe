// Ignores unknown flags and starts its default action, which never ends.
const arg = process.argv[2];
if (arg === '--version') process.stdout.write('1.0.0\n');
else if (arg === '--help') process.stdout.write('Usage: serve\n');
else setInterval(() => {}, 1000);
