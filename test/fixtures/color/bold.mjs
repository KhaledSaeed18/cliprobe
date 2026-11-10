// Always prints bold, even into a pipe. Styling counts, not just color.
process.stdout.write('\x1b[1mTitle\x1b[22m\n');
