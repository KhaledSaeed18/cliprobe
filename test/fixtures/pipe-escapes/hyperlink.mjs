// Prints an OSC 8 hyperlink even into a pipe.
process.stdout.write('see \x1b]8;;https://example.com\x07the docs\x1b]8;;\x07\n');
