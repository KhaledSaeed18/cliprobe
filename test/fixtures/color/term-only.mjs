// Decides color from TERM alone, so it colors pipes whenever TERM allows it.
const color = process.env.TERM && process.env.TERM !== 'dumb';
process.stdout.write(color ? '\x1b[36minfo\x1b[0m\n' : 'info\n');
