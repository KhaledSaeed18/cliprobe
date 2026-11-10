// Has no --version: exits 1 with a usage error.
process.stderr.write('unknown option --version\n');
process.exitCode = 1;
