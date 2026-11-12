// A watcher that colors its log lines even into a pipe, and never exits.
setInterval(() => process.stdout.write('\x1b[32mrebuilt\x1b[0m\n'), 100);
