// Draws a spinner frame (no newline, a carriage return) and then waits for stdin: not a prompt.
process.stderr.write('\r- reading input');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => process.stdout.write(`${input.length} bytes\n`));
