#!/usr/bin/env node
// Answers --help and --version at once; with no file it filters stdin, as a filter should.
const arg = process.argv[2];
if (arg === '--help') process.stdout.write('usage: filter [file]\n');
else if (arg === '--version') process.stdout.write('1.0.0\n');
else {
    let input = '';
    process.stdin.on('data', (c) => (input += c));
    process.stdin.on('end', () => process.stdout.write(input.toUpperCase()));
}
