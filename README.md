# cliprobe

Black-box tests any command-line program for terminal-edge bugs: the ones that only show up when output is piped, cut short, or read by a script or an AI agent.

```sh
npx cliprobe -- esbuild
```

```
cliprobe 0.0.1: closed-pipe check for esbuild

  FAIL   esbuild --version  crashed when stdout was closed (exit 0 -> 1)
                            Error: Command failed: .../esbuild --version (at node_modules/esbuild/bin/esbuild:222:28)
  FAIL   esbuild --help     crashed when stdout was closed (exit 0 -> 1)
                            Error: Command failed: .../esbuild --help (at node_modules/esbuild/bin/esbuild:222:28)

2 failed, 0 warned, 0 passed, 0 skipped
```

## Why

When a program's output goes into a reader that stops early (`| head`, `grep -q`, a closed agent pipe), its next write to stdout fails. A well-behaved program exits quietly. Many Node.js CLIs instead crash with `Error: write EPIPE`, a stack trace, and exit code 1. That breaks scripts running under `set -o pipefail` and confuses agents that read stderr.

In a census of the 100 most-downloaded npm packages that ship a command, **8 crashed this way every time**: esbuild, browserslist, update-browserslist-db, autoprefixer, husky, tsconfck, ts-jest and rolldown. The best-known existing CLI auditor rated all 8 as passing its SIGPIPE check.

## Usage

```sh
npx cliprobe -- <command>                 # probes "<command> --version" and "<command> --help"
npx cliprobe -- <command> [args...]       # probes exactly this invocation
npx cliprobe -- node ./dist/cli.js list   # test your own CLI before publishing
npx cliprobe --json -- <command>          # machine-readable results
npx cliprobe -- ls {fixture}              # {fixture}: a directory of hostile file names
npx cliprobe --check startup,baseline -- node ./dist/cli.js   # info checks, only when named
```

| Option            | Meaning                                                  |
| ----------------- | -------------------------------------------------------- |
| `--check <name>`  | Run only this check; repeat it or use commas for several |
| `--json`          | Print results as JSON, including the checks that ran     |
| `--timeout <ms>`  | Kill a probe after this long (default 15000)             |
| `-h`, `--help`    | Show help                                                |
| `-v`, `--version` | Show the version                                         |

Exit codes: `0` no failures, `1` a check failed, `2` usage error or the command could not run. That makes it usable as a CI gate.

## Checks

A default run does the four checks below: closed-pipe, color, ctrl-c and control-chars. Each one reports evidence, never a score. Two info checks, startup and baseline, run only when you name them with `--check`.

**closed-pipe**. cliprobe runs the command twice: once normally, then with stdout set to a pipe whose reading end is already closed, so the first write fails every time, even for fast native programs. Results:

| Verdict | Meaning                                                                        |
| ------- | ------------------------------------------------------------------------------ |
| `PASS`  | Exited quietly, or was stopped by SIGPIPE (the Unix convention)                |
| `FAIL`  | Printed an EPIPE error or stack trace and changed its exit code, or hung       |
| `WARN`  | Printed a write error but kept its exit code                                   |
| `SKIP`  | Wrote nothing to stdout for this invocation, so pass args that print something |

**color**. cliprobe runs the command up to three times: into a pipe, under a real terminal (a pseudo-terminal through the system's `script` command, 80×24), and under a terminal with `NO_COLOR=1`. Every run gets `TERM=xterm-256color` and no `CI` variable, so a program can't pass just because the terminal type looks colorless, and color libraries that force color in CI don't fail it. Color codes in piped output end up in log files and agent transcripts as `\x1b[31m` noise. Results:

| Verdict | Meaning                                                                                      |
| ------- | -------------------------------------------------------------------------------------------- |
| `PASS`  | No color in a pipe; in a terminal, either no color at all or color that `NO_COLOR` turns off |
| `FAIL`  | Printed color or style codes (bold counts, a bare reset doesn't) to stdout in a pipe         |
| `WARN`  | Printed color to stderr in a pipe, or kept printing color under `NO_COLOR`                   |
| `SKIP`  | Printed nothing, waited for input in a terminal, or no usable `script` (BusyBox)             |

Many classic tools (git, BSD `ls` and `grep`) color correctly but don't implement [`NO_COLOR`](https://no-color.org), so they get a `WARN`, never a `FAIL`. Probe a command that prints color in normal use: almost no CLI colors its `--help`.

**ctrl-c**. cliprobe lets the command run for 1 second, then sends SIGINT to its process group, which is what a terminal does when you press Ctrl-C, and gives it 3 seconds to exit. Results:

| Verdict | Meaning                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------- |
| `PASS`  | Stopped by SIGINT, exited 130 (the convention), or exited with another failure code            |
| `FAIL`  | Still running 3 seconds later, or printed a stack trace or traceback after the Ctrl-C          |
| `WARN`  | Exited 0, so a script or an agent can't tell the work was interrupted                          |
| `SKIP`  | Finished before the Ctrl-C, as `--version` and `--help` do: probe a command that keeps running |

A stack trace printed before the Ctrl-C doesn't count. Python's default `KeyboardInterrupt` traceback is the classic failure here, so `python3 -c 'import time; time.sleep(30)'` fails.

**control-chars**. Put `{fixture}` in the arguments where your command takes a path, for example `npx cliprobe -- ls {fixture}` or `npx cliprobe -- node ./dist/cli.js scan --dir={fixture}`. cliprobe replaces it with a temporary directory of file names holding escape sequences (one sets the window title, one clears the screen), a C1 control character, a carriage return, a newline and a bidirectional override. It runs the command under a terminal and looks for those characters, unescaped, in what reaches it. A file name that can clear someone's screen or retitle their window is a terminal injection, the same bug class as the `ls`/`find` escaping that GNU coreutils added years ago. Reports show `{fixture}`, never the temporary path, and the directory is removed afterwards. Results:

| Verdict | Meaning                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| `PASS`  | Escaped or replaced the control characters (a raw bidi override is mentioned, not judged)                   |
| `FAIL`  | Sent an escape sequence from a file name to the terminal unescaped                                          |
| `WARN`  | Printed a C1 control, carriage return or newline from a file name unescaped, which can hide or forge output |
| `SKIP`  | No `{fixture}` in the arguments, the command never printed the file names, or no usable `script`            |

Only the terminal run is judged. Into a pipe, `ls` and `find` print names exactly, by design; that is recorded in the JSON (`pipeRaw`) but doesn't affect the verdict. BSD `find` on macOS fails this check: unlike GNU `find`, it prints names raw even to a terminal.

### Info checks

These report an observation with the verdict `INFO` and never fail. They run only when named, for example `--check startup,baseline`. With probe args, those args are treated as the program: `npx cliprobe --check baseline -- node ./dist/cli.js` probes `node ./dist/cli.js --version`, and so on.

**startup**. The median wall time over 5 runs, after one warm-up, of `<command> --version`, or of the probe exactly as given. It's skipped if that invocation exits non-zero.

**baseline**. Appends `--version`, `--help` and `--cliprobe-unknown-flag` to the probe and describes what scripts and agents rely on: one version line on stdout, help on stdout with exit 0, and a non-zero exit with the message on stderr for a flag the program doesn't know. A program that ignores unknown flags will run its default action (it's stopped after 5 seconds), which is why baseline never runs unless you ask for it.

## Fixing a failure in a Node.js CLI

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

**ctrl-c:** Node's default already does the right thing, dying by SIGINT. If you add a handler to clean up, finish by exiting 130 rather than 0, and don't throw from it:

```js
process.once('SIGINT', async () => {
  await cleanUp();
  process.exit(130);
});
```

**control-chars:** escape names (and any other text you didn't write) before printing them for a person. `JSON.stringify` alone isn't enough: it leaves C1 controls and bidi overrides raw.

```js
const shown = name.replace(
  /[\x00-\x1f\x7f-\x9f]/g,
  (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
);
```

Also escape U+2028, U+2029 and the bidi controls (U+202A to U+202E, U+2066 to U+2069) if names may come from untrusted sources.

## Safety

cliprobe runs the target in your current directory without a shell, with stdin closed, a temporary `HOME`, and a minimal environment (no tokens from your shell). It still executes the program, so only probe programs you trust. By default cliprobe passes only the arguments you give, or `--version` and `--help`; only the baseline check, when you name it, adds an unknown flag. It kills each run's whole process group on timeout, including under a pseudo-terminal. macOS and Linux only for now.

## License

MIT
