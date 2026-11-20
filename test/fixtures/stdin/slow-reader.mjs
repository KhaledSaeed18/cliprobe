#!/usr/bin/env node
// Reads all of stdin, then takes 1.5 s to answer: slow, and it does wait for stdin.
process.stdin.resume();
process.stdin.on('end', () => setTimeout(() => console.log('done'), 1500));
