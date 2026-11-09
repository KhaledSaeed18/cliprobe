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

| Option | Meaning |
|---|---|
| `--json` | Print results as JSON |
| `--timeout <ms>` | Kill a probe after this long (default 15000) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

Exit codes: `0` no failures, `1` a check failed, `2` usage error or the command could not run. That makes it usable as a CI gate.

## Checks

**closed-pipe** (0.0.1). cliprobe runs the command twice: once normally, then with stdout set to a pipe whose reading end is already closed, so the first write fails every time, even for fast native programs. Results:

| Verdict | Meaning |
|---|---|
| `PASS` | Exited quietly, or was stopped by SIGPIPE (the Unix convention) |
| `FAIL` | Printed an EPIPE error or stack trace and changed its exit code, or hung |
| `WARN` | Printed a write error but kept its exit code |
| `SKIP` | Wrote nothing to stdout for this invocation, so pass args that print something |

Planned next: color handling under a real terminal vs a pipe vs `NO_COLOR`, Ctrl-C behavior, control characters in output, and startup time.

## Fixing a failure in a Node.js CLI

Handle `EPIPE` on stdout once, near your entry point:

```js
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
```

## Safety

cliprobe runs the target in your current directory without a shell, with stdin closed, a temporary `HOME`, and a minimal environment (no tokens from your shell). It still executes the program, so only probe programs you trust. macOS and Linux only for now.

## License

MIT
