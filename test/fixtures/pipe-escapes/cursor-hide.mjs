// Hides and shows the cursor even into a pipe.
process.stdout.write('\x1b[?25lok\n\x1b[?25h');
