// In a terminal it prompts and keeps waiting for an answer; in a pipe it prints plain text.
if (process.stdin.isTTY) {
    process.stdout.write('Name? ');
    process.stdin.resume();
    // A prompt loop: even after the PTY's one EOF it never gets a usable answer.
    setInterval(() => {}, 1000);
} else {
    process.stdout.write('ok\n');
}
