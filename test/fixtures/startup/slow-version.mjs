// Takes about 150 ms before it answers --version.
const until = Date.now() + 150;
while (Date.now() < until) {
    // busy wait, so the time is spent in the process like real startup work
}
process.stdout.write('1.0.0\n');
