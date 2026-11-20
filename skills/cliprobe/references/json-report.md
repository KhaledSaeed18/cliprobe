# JSON report reference

`cliprobe --json -- <command>` (the same as `--format json`) prints one JSON document on stdout. It is described by a JSON Schema that ships in the package as `cliprobe/schema.json` ([view it](https://unpkg.com/cliprobe@1/schema.json)). Within 1.x, fields are only added, never removed, renamed or retyped.

| Field           | Contents                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `tool`          | Always `"cliprobe"`                                                                                        |
| `schemaVersion` | Always `1` in 1.x                                                                                          |
| `version`       | The cliprobe version that wrote the report                                                                 |
| `command`       | The command after `--`                                                                                     |
| `checks[]`      | The checks that ran, in order                                                                              |
| `strict`        | Whether `--strict` was given                                                                               |
| `summary`       | A count per verdict: `pass`, `fail`, `warn`, `skip`, `error`, `info`                                       |
| `results[]`     | One per check and probe                                                                                    |
| `.check`        | The check's name                                                                                           |
| `.invocation[]` | The command and arguments that ran, `{fixture}` included as written                                        |
| `.verdict`      | `pass`, `fail`, `warn`, `skip`, `error` (could not run) or `info`                                          |
| `.reason`       | A sentence for a person; its wording may change between releases                                           |
| `.evidence`     | The line that proves it, when there is one, for example the EPIPE error and the first frame in the program |
| `.details`      | The check's own measurements: exit codes, timings, terminal modes left on, processes left running          |

Text from the program is escaped in the JSON text: control characters, line separators and bidi overrides appear as `\u` escapes. Parsing the JSON turns them back into the real characters, so escape `evidence` and `invocation` again before printing them to a terminal (`JSON.stringify` does). Match on `check` and `verdict`, never on `reason` text.

## What each check looks for

| Check           | Default probes        | Fails when                                                                              | Warns when                                                                |
| --------------- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `closed-pipe`   | yes                   | It prints an EPIPE error or stack and changes its exit code, or hangs, on a closed pipe | It prints a write error but keeps its exit code                           |
| `color`         | yes                   | Color or style codes reach stdout in a pipe                                             | Color reaches stderr in a pipe, or `NO_COLOR` doesn't turn it off         |
| `pipe-escapes`  | yes                   | Cursor, erase, hyperlink, title or redraw codes reach a pipe                            | Only carriage returns reach the pipe                                      |
| `stdin`         | yes                   | `--help` or `--version` waits for stdin                                                 | A probe you wrote prompts although stdin isn't a terminal                 |
| `ctrl-c`        | needs a running probe | It keeps running 3 s after Ctrl-C, or prints a stack trace                              | It exits 0 after Ctrl-C, or leaves processes running that ignored it      |
| `sigterm`       | needs a running probe | Never; new checks start as warnings                                                     | It ignores SIGTERM, prints a stack trace, or leaves processes running     |
| `restore`       | yes                   | Never                                                                                   | A terminal mode (hidden cursor, alternate screen, ...) is left on         |
| `control-chars` | needs `{fixture}`     | An escape sequence from a file name reaches the terminal unescaped                      | A C1 control, carriage return or newline from a name reaches it unescaped |

`SKIP` always says what was missing: a probe that keeps running, a probe with `{fixture}`, output to judge, or the `script` command. Two info checks, `startup` and `baseline`, run only when named with `--check` and never fail.

## One-liners

`node` is always available where cliprobe runs:

```bash
# Every failure and warning, one per line; JSON.stringify keeps escape codes in the evidence escaped
cliprobe --json -- ./dist/cli.js | node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const x of r.results.filter((x) => x.verdict === "fail" || x.verdict === "warn"))
    console.log(x.verdict, x.check, JSON.stringify(x.invocation), x.reason, JSON.stringify(x.evidence ?? ""));'

# The counts only
cliprobe --json -- ./dist/cli.js | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).summary)'
```

With `jq`: `cliprobe --json -- ./dist/cli.js | jq -r '.results[] | select(.verdict == "fail" or .verdict == "warn") | "\(.verdict) \(.check) \(.invocation | join(" ")): \(.reason)"'`.
