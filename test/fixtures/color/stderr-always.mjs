// Plain stdout, but always-colored warnings on stderr.
process.stdout.write('ok\n');
process.stderr.write('\x1b[33mwarning\x1b[0m: careful\n');
