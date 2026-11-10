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

**closed-pipe** (0.0.1). cliprobe runs the command twice: once normally, then with stdout set to a pipe whose reading end is already closed, so the first write fails every time, even for fast native programs. Results:

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

Planned next: Ctrl-C behavior, control characters in output, and startup time.

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

## Safety

cliprobe runs the target in your current directory without a shell, with stdin closed, a temporary `HOME`, and a minimal environment (no tokens from your shell). It still executes the program, so only probe programs you trust. macOS and Linux only for now.

## License

MIT
