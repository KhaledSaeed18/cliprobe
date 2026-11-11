#!/usr/bin/env node
// Reads all of stdin before looking at its arguments, so even --help waits for input.
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () =>
    process.stdout.write(`usage: tool [file] (${input.length} bytes in)\n`)
);
