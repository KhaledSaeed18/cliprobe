# AGENTS.md

Instructions for coding agents (and people) working on cliprobe. `CLAUDE.md` imports this file.

## What cliprobe is

A zero-dependency npm CLI, run as `npx cliprobe -- <command> [args...]`, that black-box tests any command-line program for terminal-edge bugs: crashes on a closed pipe, color or control codes leaking into pipes, programs that hang waiting on an open stdin, broken Ctrl-C handling, a terminal left with its cursor hidden or other modes on after Ctrl-C, and control characters from file names reaching the terminal. It reports evidence (the error line, the first stack frame in the target's own code), never a score.

## Commands

| Command              | What it does                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm install`       | Install dev dependencies (pnpm version pinned in `packageManager`)                                           |
| `pnpm build`         | Build `dist/cli.js` with tsdown                                                                              |
| `pnpm dev <args>`    | Run the CLI from source (Node strips the TypeScript types), e.g. `pnpm dev --check closed-pipe -- printf hi` |
| `pnpm test`          | Run the Vitest suite (it builds `dist/` first)                                                               |
| `pnpm test:coverage` | Same, with v8 coverage and the threshold ratchet                                                             |
| `pnpm check`         | Everything CI runs: typecheck, lint, format, build, coverage, publint                                        |

Run `pnpm check` before pushing.

## Layout

| Path          | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/`    | `args.ts` (option parsing), `help.ts` (help text), `program.ts` (`run(argv, io)`, the whole CLI, and `exitCodeFor`), `main.ts` (wires the real process into `run`)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/checks/` | One file per check, each exporting a `Check`; `index.ts` is the registry (`CHECKS`, `selectChecks`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/core/`   | `run.ts` (spawning: no shell, detached group, timeouts, closed-stdout FIFO, stdin as `/dev/null` or an open or closing pipe, delayed signals), `pty.ts` (pseudo-terminal through `script(1)`, with optional typed input such as Ctrl-C), `ansi.ts` (color, control codes, terminal modes left on), `which.ts` (PATH lookup; a missing command stops the run before any check), `long-running.ts` (probes still running at the timeout: later checks watch them for 3 s), `quote.ts` (shell-style quoting of invocations for display), `safe.ts`, `fixture.ts`, `types.ts` |
| `src/report/` | One formatter per output format (`human`, `json`, `markdown`, `junit`) behind `FORMATS`, plus `summary.ts` and `write.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `test/`       | Vitest; `helpers/cli.ts` runs the CLI in-process; `bin.test.ts` spawns the built file; `release-config.test.ts` runs the real semantic-release plugins on `.releaserc.json`; `fixtures/<check>/` hold pass and fail programs                                                                                                                                                                                                                                                                                                                                              |
| `.github/`    | `workflows/ci.yml` (quality, Linux on Node 22/24/26, macOS on Node 22, Alpine; a change touching only Markdown, `LICENSE` or `.github/assets` skips the test jobs), `workflows/release.yml` (CI, then semantic-release to npm); `dependabot.yml` (weekly grouped updates as `build`/`ci` commits, which never release); `assets/cliprobe-banner.png` (the README banner, 2560×1280)                                                                                                                                                                                       |

## Product rules

- **Evidence, never a score.** Every result is pass, fail, warn, skip, error or info, with the evidence attached.
- **No false fails.** A new check starts as warn-only and is calibrated against real tools (the census of the top-100 npm CLIs, run in Docker) before it may fail.
- **Deterministic.** No races: a closed pipe is a FIFO closed before spawn, Ctrl-C is a signal to the process group, the PTY gets an 80x24 window.
- **Safety.** No shell; detached process group, whole group killed on timeout (including under the PTY); stdin is `/dev/null`, except that the stdin check gives it a pipe it never writes to and then closes; the only input ever sent is Ctrl-C (a signal in ctrl-c, a typed key in restore) to probes the user wrote; minimal environment with a temporary `HOME`. Only `baseline`, when named, sends a flag the user didn't give.
- **Practise what we check.** Every piece of target text is escaped before output: `safe()` for human output, `safeJson()`, `code()`/`prose()` in Markdown, `xml()` in JUnit. cliprobe survives its own closed stdout.

## Keep everything in sync

Every change, whether a feature, a fix or a refactor, lands with all related material updated **in the same branch**. Nothing ships with docs that describe the old behavior. Before pushing, check each item that applies:

- [ ] `src/cli/help.ts`: the check list, options and their descriptions
- [ ] `README.md`: the intro example, the "Why" numbers, the usage block, the options table, the count of default checks (now "seven checks"), each check's section and verdict table, "In CI", "Fixing a failure", and "Safety"
- [ ] `AGENTS.md`: this file, when the layout, commands, rules or workflow change
- [ ] Tests and fixtures: pass and fail fixtures for each behavior, real tools that must not fail, and the black-box suite in `test/bin.test.ts`
- [ ] `package.json` `description` and `keywords`, when the scope changes
- [ ] Hard-coded lists in tests that enumerate every check or format (`test/args.test.ts`, `test/cli.test.ts`)

Search the repo for the old wording or numbers (`rg "six checks"`) before you push.

## Adding a check

1. `src/checks/<name>.ts`: a `Check` (`name`, `kind`, `summary`, `run`) plus a pure `judge…()` function that turns run results into a verdict.
2. Register it in `CHECKS` in `src/checks/index.ts` (the order is the run and report order).
3. `test/fixtures/<name>/`: small programs that should pass, warn, fail and skip; `test/<name>.test.ts` with one case per fixture, plus real tools that must not fail.
4. Then the sync checklist above: help, README section with a verdict table, `AGENTS.md`.

## Workflow and conventions

- **Small conventional commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `ci:`, `build:`, `chore:`), enforced by commitlint. npm shows the README from the last published version, so a README change that should reach npm is a `docs(readme):` commit, which releases a patch; other `docs:` commits never release. No `Co-Authored-By` or other attribution lines. Don't start a body line with `word:`, because it parses as a git trailer.
- **One branch and PR per release.** Pushing a `feat` or `fix` commit to `main` publishes to npm through semantic-release, so features go through a PR, and merging is the release. The maintainer approves each merge.
- **Merge with "rebase and merge",** never squash, so every `feat` and `fix` lands in the changelog.
- **Dependabot** opens at most one grouped pull request per group each Monday (npm minor and patch, npm major, GitHub Actions). Its commits are `build(deps-dev)` and `ci(deps)`, so merging one never publishes; ship it with the next `feat` or `fix`. `@types/node` stays on the major of the oldest supported Node.
- **Run third-party CLIs only in a disposable Docker container with `--network none`,** never on the host. The test suite runs only cliprobe's own fixtures and standard system tools.
- **Platforms:** macOS and Linux (including Alpine, where `script(1)` comes from `util-linux-misc`), Node 22.12 or later. Windows is not supported.

## Gotchas

- Node puts a TTY stdin into non-blocking mode, so `fs.readSync(0)` throws `EAGAIN` under a PTY; fixtures that prompt must use stream events.
- `isolatedDeclarations` is on: exported values need explicit types.
- Build characters such as U+2028 or U+202E with `String.fromCharCode` in source and tests, rather than `\u` escapes that tooling may decode.
- Coverage thresholds in `vitest.config.ts` are a ratchet: raise them as coverage grows, never lower them.
- The `script(1)` flavors differ (BSD on macOS, util-linux on Linux); `src/core/pty.ts` documents each difference it handles.
- Type Ctrl-C into the PTY (`\x03`) rather than sending SIGINT when it should behave like a keypress: a program in raw mode (prompts, full-screen views) never gets SIGINT from a terminal, only the key, and signalling it gives false results.
- On macOS, Node's stdio pipes and FIFOs are sockets, and BSD `script(1)` refuses a socket as stdin, so typed input reaches it through `cat`. BSD `script` also waits for EOF on stdin after the program exits.
- semantic-release loads its changelog preset from its own install first, which under pnpm finds whatever was hoisted (commitlint depends on a newer preset). `pnpm-workspace.yaml` keeps the preset out of the hoist, and `test/release-config.test.ts` fails on a preset the release can't render, since the release itself only runs after merging.
- A check that tests the could-not-start path can't go through the CLI, which stops early on a missing command: use `runCheck()` from `test/helpers/cli.ts`.
- A new way for an existing check to fail is a new check for the "no false fails" rule: it starts as a warn until calibrated (the closed-pipe crash of a command that keeps running was one: a warn in 0.6, a fail once 38 watch and serve probes showed no false ones).
- In a container without an init process, orphans stay zombies in their process group forever: to learn whether a program has exited, ask about its PID, not its group.
