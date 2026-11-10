// Forces color whenever CI is set, as some color libraries do.
process.stdout.write(process.env.CI ? '\x1b[35mci\x1b[0m\n' : 'ci\n');
