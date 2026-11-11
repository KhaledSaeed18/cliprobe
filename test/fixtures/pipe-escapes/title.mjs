// Sets the window title even into a pipe.
process.stdout.write('\x1b]0;my tool\x07ready\n');
