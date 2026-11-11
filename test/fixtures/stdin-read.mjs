// Reads stdin to the end, then reports how many bytes it got.
let bytes = 0;
process.stdin.on('data', (c) => (bytes += c.length));
process.stdin.on('end', () => process.stdout.write(`read ${bytes} bytes\n`));
