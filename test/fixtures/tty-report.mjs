// Reports what it sees about its terminal, writes a line to stderr, then exits
// with the code given as the first argument (default 0).
process.stdout.write(
    JSON.stringify({
        stdin: Boolean(process.stdin.isTTY),
        stdout: Boolean(process.stdout.isTTY),
        stderr: Boolean(process.stderr.isTTY),
        cols: process.stdout.columns ?? null,
        rows: process.stdout.rows ?? null,
        TERM: process.env.TERM ?? null,
        NO_COLOR: process.env.NO_COLOR ?? null,
        CI: process.env.CI ?? null,
    }) + '\n'
);
process.stderr.write('to stderr\n');
process.exitCode = Number(process.argv[2] ?? 0);
