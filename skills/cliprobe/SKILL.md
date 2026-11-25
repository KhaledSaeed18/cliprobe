---
name: cliprobe
description: Test a command-line program for terminal-edge bugs with cliprobe, by running it the way pipes, CI and agents do. Finds crashes on a closed pipe (EPIPE with | head), color and escape codes leaking into pipes, hangs waiting on stdin, Ctrl-C ignored, child processes left running after SIGTERM, a terminal left broken, and control characters from file names reaching the terminal. Use when someone builds, reviews or publishes a CLI, asks whether it behaves in pipes, CI or for agents, debugs EPIPE, NO_COLOR or Ctrl-C handling, or wants such a check in CI.
license: MIT
compatibility: Requires Node.js 22.12 or later, macOS or Linux (not Windows), and the script command for the terminal checks. Runs cliprobe 1.2 or later (below 2) from npm (installed or through npx); network access is needed only if npx must download it.
metadata:
  author: Khaled Saeed
  version: '1.0.0'
  homepage: https://github.com/KhaledSaeed18/cliprobe
---

# cliprobe

Answer "does this CLI behave in a pipe, in CI and when interrupted?" with evidence from `cliprobe`, a zero-dependency Node.js tool that runs the program under the conditions where these bugs show up and reports each result as `PASS`, `FAIL`, `WARN`, `SKIP`, `ERROR` or `INFO`, with the line that proves it. It never gives a score.

## 1. Pick the command once

This skill is written for cliprobe **1.2 or later, below 2**. Run these checks in order and use the first one that prints such a version:

```bash
cliprobe --version                    # installed globally or in the project
npx --yes "cliprobe@^1.2" --version   # no install needed; downloads to the npx cache
```

Keep the quotes and the `^1.2` range: a plain `@1` lets npx reuse an older cached 1.x without `--probe`.

- If the installed version is older than 1.2, prefer the npx command, and suggest updating to the user rather than doing it yourself.
- Never replace cliprobe with your own checks (`| head`, `| cat -v`, `kill -INT`) without telling the user that you did and why. Results of your own commands are not results from cliprobe.
- On Windows, stop and say that cliprobe supports macOS and Linux only; WSL may work but isn't tested.
- If Node.js is missing or older than 22.12, stop and tell the user.

The examples below write `cliprobe` for whichever command worked. Inside the cliprobe source repository you can also use `node dist/cli.js` after `pnpm build`.

## 2. Ground rules

- **cliprobe runs the program.** It executes the command with the user's privileges, in the current directory, so probing is running. Probe the user's own CLI, or programs they trust. For anything else, such as a package they found on npm, say so and run it in a disposable container with networking off (`docker run --rm --network none ...`), or ask first.
- **Only probe harmless commands.** cliprobe runs each probe several times. Never probe a command that deletes, publishes, deploys, sends messages or writes outside a temporary directory. Read the program's `--help` to choose probes.
- **Probe what users run, after building it.** Run the build first, then probe the built entry point, not the sources.
- **Name the program the way a user types it.** Everything after `--` is one invocation; `--probe` adds more invocations of the same command:
  - An executable with a shebang (`bin` in `package.json`, or a file with the executable bit): `cliprobe -- ./dist/cli.js` probes `./dist/cli.js --version` and `./dist/cli.js --help`, and `--probe watch` adds `./dist/cli.js watch`.
  - A script run through `node`: the command is `node`, so give the script in every probe: `cliprobe --probe "./dist/cli.js --version" --probe "./dist/cli.js watch" -- node ./dist/cli.js --help`. `cliprobe -- node ./dist/cli.js` alone probes only `node ./dist/cli.js`, and `--probe watch` would run `node watch`.
- **Cover every check in one run.** By default cliprobe probes `--version` and `--help`. Three checks need more: `ctrl-c` and `sigterm` need a command that keeps running (a server, a watcher: `--probe "serve --port 0"`, `--probe watch`), and `control-chars` needs a command that prints file names from `{fixture}`, a directory of hostile names cliprobe creates (`--probe "list {fixture}"`). A `SKIP` says which probe was missing.
- **Use `--json` for facts and the human report for people.** The JSON has `summary` (a count per verdict) and `results[]` with `check`, `invocation`, `verdict`, `reason`, `evidence` and `details`. The human report cuts evidence past 200 characters and doubles a backslash the program printed, so quote evidence from the JSON. See [references/json-report.md](references/json-report.md).
- **Read the exit code.** `0` no check failed, `1` a check failed (or warned, with `--strict`), `2` a usage error, a command that could not run, or a report file that could not be written.
- **`FAIL` and `WARN` are different.** A fail is a confirmed bug. A warn is a new or uncertain finding, which never fails a build without `--strict`. Report both, and say which is which.
- **Don't fix the program on your own.** Report findings with their evidence and the fix you propose; change code only when the user asks.

## 3. Check a CLI

1. Find the entry point and the commands that keep running or print file names: read `package.json` (`bin`, `scripts.build`) and the program's `--help`.
2. Build it, then run every check in one go:

   ```bash
   cliprobe --json --probe watch --probe "list {fixture}" -- ./dist/cli.js
   ```

   A probe that keeps running is judged on what it did before `--timeout` (15 seconds by default) and then stopped; later checks watch it for 3 seconds. Use `--timeout 5000` to keep runs short when the program starts quickly.

3. Run one check again while you work on it: `cliprobe --check closed-pipe -- ./dist/cli.js`. `--skip` leaves a check out.

Report every `FAIL` and `WARN` with its check, the invocation, the reason and the evidence line, then the fix. Say what was skipped and why, so the user knows what was not tested.

## 4. Fix what failed

The fixes for a Node.js CLI, each a few lines near the entry point (see [references/fixes.md](references/fixes.md) for code):

| Check           | What it means                                                                                                  | Fix                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `closed-pipe`   | Crashed with `EPIPE` when the reader stopped early (`\| head`)                                                 | Handle `EPIPE` on stdout once and exit quietly                                              |
| `color`         | Printed color codes into a pipe, or ignored `NO_COLOR`                                                         | Decide color from `process.stdout.isTTY` and `NO_COLOR`                                     |
| `pipe-escapes`  | Spinner, cursor or progress codes in a pipe                                                                    | Draw them only when the stream is a terminal; print plain lines otherwise                   |
| `stdin`         | `--help` or `--version` waited for input, or a prompt with no TTY                                              | Look at the arguments before reading stdin; prompt only when `process.stdin.isTTY`          |
| `ctrl-c`        | Kept running after Ctrl-C, or crashed with a stack trace; exiting 0, or leaving children that ignore it, warns | Keep Node's default, or clean up and then die by `SIGINT` again                             |
| `sigterm`       | Ignored SIGTERM, or left child processes running                                                               | Pass the signal on to each child and wait for it; `exec` the last command in a shell script |
| `restore`       | Left the cursor hidden or a terminal mode on after Ctrl-C                                                      | Switch every mode off in an `exit` handler, and turn `SIGINT` into `process.exit(130)`      |
| `control-chars` | Printed control characters from file names to the terminal                                                     | Escape names before printing them for a person                                              |

After a fix, build again and rerun the same cliprobe command; the fixed checks should pass and nothing else should change.

## 5. Add it to CI

A failed check exits 1, so the step fails. Pin the major version and include the probes:

```yaml
- name: Check the CLI for terminal-edge bugs
  run: npx --yes cliprobe@1 --probe watch --probe "list {fixture}" --format markdown --output-file "$GITHUB_STEP_SUMMARY" -- ./dist/cli.js
```

`--format markdown --output-file "$GITHUB_STEP_SUMMARY"` puts the report in the job summary while the log keeps the human report; `--format junit --output-file reports/cliprobe.xml` writes JUnit XML for CI test reports. Add `--strict` only when the user wants warnings to fail the build too, and say that a new cliprobe minor release can then add a warning; `--skip <check>` leaves out a check whose warning they accept.

## 6. Troubleshooting

- **Exit `2` and no report:** the command can't run, or the arguments to cliprobe are wrong. The message says which: not found (check the path after `--`; a relative path needs `./`), a directory, not executable (`chmod +x`), or a missing `#!` interpreter. An `--output-file` path that can't be written (a directory, a folder without write permission) also stops it up front.
- **Everything `SKIP`ped in ctrl-c and sigterm:** no probe kept running for a second. Add a `--probe` for a watch or serve command. With `--bare` on a REPL (`python3`), ctrl-c skips a program that prints nothing and outlives the Ctrl-C, because its stdin is a pipe, not a terminal: say that its Ctrl-C wasn't tested.
- **`control-chars` skipped:** no probe contained `{fixture}`, or the probe didn't print the names.
- **`ERROR`:** the probe could not start or crashed before any check could judge it; the reason says why.
- **A `SKIP` that adds "it exited N, so the probe may not have run as intended":** the probe failed before doing anything; the evidence quotes its error line. Fix the probe's arguments. With `-- node ./dist/cli.js`, a `--probe` must name the script too (see section 2).
- **The terminal checks can't run:** they need `script`, which macOS and most Linux distributions ship. If it's missing, install `bsdutils` on Debian and Ubuntu, `util-linux-script` on Fedora, `util-linux-misc` on Alpine.
- **It behaves differently than in your shell:** cliprobe runs the program with no shell and a minimal environment: `PATH`, `LANG`, a temporary `HOME` and `TMPDIR`, `NO_UPDATE_NOTIFIER=1`, and `TERM=dumb` with `CI=1` except in color, pipe-escapes and control-chars, which use `TERM=xterm-256color` and no `CI`. `LC_ALL` and other `LC_*` variables don't reach it. The README's "The probe's environment" has the full table.
- Other options: `cliprobe --help` lists them all, and `--check startup,baseline` adds two info checks (startup time, and conventions for `--version`, `--help` and unknown flags).
