// A server that logs a line every 100 ms and never exits; Node's default EPIPE
// handling crashes it once stdout is closed.
setInterval(() => process.stdout.write('request handled\n'), 100);
