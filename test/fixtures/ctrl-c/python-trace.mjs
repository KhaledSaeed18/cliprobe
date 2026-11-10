// Prints what an unhandled KeyboardInterrupt looks like in Python, then exits 1.
process.on('SIGINT', () => {
    process.stderr.write(
        'Traceback (most recent call last):\n' +
            '  File "/app/main.py", line 3, in <module>\n' +
            '    time.sleep(30)\n' +
            'KeyboardInterrupt\n'
    );
    process.exit(1);
});
setInterval(() => {}, 1000);
