// A dev server that draws a spinner on stderr even into a pipe, and never exits.
process.stdout.on('error', () => {});
let i = 0;
setInterval(() => process.stderr.write(`\r${'|/-\\'[i++ % 4]} starting`), 100);
