// Takes 1.5 s to shut down after Ctrl-C, then exits 130.
process.on('SIGINT', () => setTimeout(() => process.exit(130), 1500));
setInterval(() => {}, 1000);
