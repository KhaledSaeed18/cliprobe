// Exits normally, but hangs forever if writing to stdout fails.
process.stdout.on("error", () => setInterval(() => {}, 1000));
process.stdout.write("hello\n");
