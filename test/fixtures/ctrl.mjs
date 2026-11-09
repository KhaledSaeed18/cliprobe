// Crashes on a closed stdout with an error message that carries a terminal escape.
process.stdout.on("error", () => {
  process.stderr.write("Error: write EPIPE \u001b]0;pwned\u0007\n");
  process.exit(3);
});
process.stdout.write("hello\n");
