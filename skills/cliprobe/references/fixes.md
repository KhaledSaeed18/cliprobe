# Fixing a failure in a Node.js CLI

Each fix goes near the program's entry point, once. After a fix, build again and rerun the same cliprobe command.

**closed-pipe:** handle `EPIPE` on stdout once, near your entry point:

```js
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});
```

**color:** decide once, from the stream you write to:

```js
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
```

`util.styleText` makes that decision for you on Node 22.13 and later (its `validateStream` option, on by default), and most color libraries check `isTTY` already, but some turn color on whenever `TERM` allows it or `CI` is set.

**pipe-escapes:** draw spinners, progress bars and prompts only when the stream is a terminal, and print plain lines otherwise:

```js
if (process.stderr.isTTY) {
  startSpinner(); // frames, \r and cursor codes only on a terminal
} else {
  console.error('building...'); // one plain line per step in a pipe
}
```

Most spinner libraries check `isTTY` already. Prompt libraries may not, so check `process.stdin.isTTY` before asking anything (see stdin below).

**stdin:** look at your arguments before reading stdin, so `--help` and `--version` answer at once, and only prompt when stdin is a terminal:

```js
if (process.stdin.isTTY) askTheQuestion();
else useTheDefault(); // or fail with a message saying which flag to pass
```

**ctrl-c:** Node's default already does the right thing, dying by SIGINT. If you add a handler to clean up, finish by dying the same way, and don't throw from it:

```js
process.once('SIGINT', async () => {
  await cleanUp();
  process.kill(process.pid, 'SIGINT'); // the handler is gone, so this ends the process
});
```

That matters to the shell that started you: bash stops a script on Ctrl-C only when the program died by the signal. After an exit with 130 or 0, the script carries on to its next command; 130 at least stops `&&` chains and `set -e`, which 0 doesn't.

**sigterm:** stop what you started before you exit. Pass the signal on to each child and wait for it:

```js
const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
process.once('SIGTERM', () => {
  server.once('exit', () => process.exit(0));
  server.kill('SIGTERM');
});
```

A shell wrapper should `exec` its last command (`sh -c 'exec node server.js'`), so the signal goes straight to it instead of to a shell that dies and leaves it running.

**restore:** switch every mode back off on the way out, including after Ctrl-C. Node runs `exit` handlers on `process.exit()` but not when a signal kills it, so turn SIGINT into an exit, and in raw mode, where Ctrl-C arrives as the key `\x03`, exit on that key too:

```js
process.stdout.write('\x1b[?25l'); // hide the cursor
process.on('exit', () => process.stdout.write('\x1b[?25h')); // and always show it again
process.once('SIGINT', () => process.exit(130));
```

**control-chars:** escape names (and any other text you didn't write) before printing them for a person. `JSON.stringify` alone isn't enough: it leaves C1 controls and bidi overrides raw.

```js
const shown = name.replace(
  /[\x00-\x1f\x7f-\x9f]/g,
  (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
);
```

Also escape U+2028, U+2029 and the bidi controls (U+202A to U+202E, U+2066 to U+2069) if names may come from untrusted sources.

For a CLI written in another language, the same rules apply: stop quietly on a broken pipe, decide color from whether the output is a terminal and from `NO_COLOR`, never read stdin before handling `--help` and `--version`, die by the signal after cleaning up, stop child processes on SIGTERM, restore terminal modes on exit, and escape names before printing them.
