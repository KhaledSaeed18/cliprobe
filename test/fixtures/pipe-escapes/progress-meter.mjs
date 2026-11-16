// Draws a progress meter on stderr with carriage returns only, as curl does into a pipe.
for (const percent of [0, 50, 100]) process.stderr.write(`\r${percent}%`);
process.stderr.write('\n');
process.stdout.write('done\n');
