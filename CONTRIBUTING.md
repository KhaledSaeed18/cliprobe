# Contributing to cliprobe

Thanks for helping. cliprobe is small and strict on purpose: every verdict it prints has to be right, because people put it in CI and act on what it says. This guide covers how to report a problem, how to set up the project, and what a pull request needs before it can be merged.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Reporting a wrong verdict](#reporting-a-wrong-verdict)
- [Development setup](#development-setup)
- [Product rules](#product-rules)
- [Making a change](#making-a-change)
- [Adding a check](#adding-a-check)
- [Agent skill](#agent-skill)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [How releases work](#how-releases-work)

## Ways to contribute

| You want to                                                    | Do this                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report a verdict you believe is wrong                          | Open a [wrong verdict](https://github.com/KhaledSaeed18/cliprobe/issues/new?template=wrong_verdict.yml) issue. These are the most valuable reports       |
| Report cliprobe itself crashing or misbehaving                 | Open a [bug report](https://github.com/KhaledSaeed18/cliprobe/issues/new?template=bug_report.yml)                                                        |
| Propose a new check, option or output format                   | Open a [feature request](https://github.com/KhaledSaeed18/cliprobe/issues/new?template=feature_request.yml) before writing code                          |
| Fix the docs                                                   | Open a pull request, or a [documentation issue](https://github.com/KhaledSaeed18/cliprobe/issues/new?template=documentation.yml)                         |
| Report something that is hard to use with assistive technology | Open an [accessibility issue](https://github.com/KhaledSaeed18/cliprobe/issues/new?template=accessibility.yml); see [ACCESSIBILITY.md](ACCESSIBILITY.md) |
| Report a security vulnerability                                | Don't open an issue. Follow [SECURITY.md](SECURITY.md)                                                                                                   |

For anything larger than a small fix, open an issue first. The [stability promise](https://github.com/KhaledSaeed18/cliprobe#stability) limits what a minor release may change, so it is worth agreeing on the shape of a change before you build it.

## Reporting a wrong verdict

A false fail breaks someone's build for no reason, and a false pass hides a real bug. To make one reproducible:

1. Run the check alone, with the JSON report: `npx cliprobe@latest --check <name> --format json -- <command> [args...]`.
2. Reproduce the behavior by hand where you can, for example `<command> --help | head -n 1` for closed-pipe, or `<command> --help | cat -v` for color and pipe-escapes.
3. Give the exact program and version you probed, your OS, and your Node.js version.

Run programs you don't trust inside a disposable container, not on your own machine: cliprobe executes the program it probes.

## Development setup

You need:

- macOS or Linux. Windows isn't supported.
- Node.js 22.18 or later. The published package runs on 22.12, but `pnpm dev` runs the TypeScript sources directly through Node's built-in type stripping, which 22.18 turned on by default.
- pnpm, at the version pinned in `packageManager` in `package.json` (`npm install --global pnpm@<version>`).
- The `script` command, which macOS and most Linux distributions ship. On Alpine, install `util-linux-misc`.

```sh
git clone https://github.com/KhaledSaeed18/cliprobe.git
cd cliprobe
pnpm install
pnpm check
```

`pnpm install` also sets up a Git hook that checks commit messages.

| Command              | What it does                                                                        |
| -------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev <args>`    | Run the CLI from source, e.g. `pnpm dev --check closed-pipe -- printf hi`           |
| `pnpm build`         | Build `dist/cli.js`                                                                 |
| `pnpm test`          | Run the Vitest suite (it builds `dist/` first and tests the built file)             |
| `pnpm test:coverage` | Same, with coverage and its thresholds                                              |
| `pnpm lint`          | oxlint with type-aware rules; warnings fail                                         |
| `pnpm format`        | Format everything with Prettier                                                     |
| `pnpm check`         | Everything CI runs: typecheck, lint, format, build, coverage and the package linter |

[AGENTS.md](AGENTS.md) maps the source tree, lists the gotchas (PTY quirks, the two flavors of `script`, Node's non-blocking TTY stdin) and is the reference for the rules below.

## Product rules

These rules decide whether a change can be merged. [AGENTS.md](AGENTS.md#product-rules) states them in full.

- **Evidence, never a score.** Every result is pass, fail, warn, skip, error or info, with the evidence that led to it.
- **No false fails.** A new check, or a new way for an existing check to fail, starts as a warning. It may only fail after it has been calibrated against real tools and produced no false fails.
- **A stable contract.** Within 1.x, a minor release never adds a fail. Check names, verdicts, options and exit codes don't change, and the JSON report only gains fields.
- **Deterministic.** No timing races: a closed pipe is a FIFO closed before the program starts, Ctrl-C is a signal to the process group or a key typed into a pseudo-terminal with a fixed 80x24 window.
- **Safe.** No shell, a detached process group that is killed on timeout, whatever a program leaves running killed when it exits, nothing left behind when cliprobe itself is stopped, a minimal environment and a temporary `HOME`. The only input cliprobe sends is Ctrl-C or SIGTERM, and only where a check needs it.
- **Practise what we check.** Every piece of text that comes from the probed program is escaped before cliprobe prints it, in every output format.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Make the change with tests. Each behavior gets a small fixture program in `test/fixtures/<check>/` that passes, warns, fails or skips as expected.
3. Update everything the change touches in the same branch: `src/cli/help.ts`, `schema.json`, the README sections, the agent skill, `AGENTS.md`, the issue forms' check list, and this file. The [pull request template](.github/pull_request_template.md) has the full checklist.
4. Run `pnpm check`.

The test suite only runs cliprobe's own fixtures and standard system tools. To try cliprobe on third-party CLIs, run them in a disposable Docker container with networking turned off (`docker run --network none ...`), never on the host.

## Adding a check

1. Add `src/checks/<name>.ts` exporting a `Check` (`name`, `kind`, `summary`, `run`) and a pure `judge…()` function that turns run results into a verdict, so the decision is testable without spawning anything.
2. Register it in `CHECKS` in `src/checks/index.ts`. The order there is the order checks run and are reported.
3. Add fixtures in `test/fixtures/<name>/` and a `test/<name>.test.ts` with one case per fixture, plus real system tools that must not fail.
4. Declare its `details` fields in `schema.json`. The tests reject any field a report contains that the schema doesn't declare.
5. Document it: the help text, a README section with a verdict table, and the check list in `.github/ISSUE_TEMPLATE/wrong_verdict.yml`.

The check ships warn-only. Promoting it to fail waits for calibration and, after 1.0, for the next major release.

## Agent skill

`skills/cliprobe/SKILL.md` teaches coding agents to run cliprobe and act on its report. When you add or rename a check or an option, or change what a check decides, update the skill and its references too: `test/skill.test.ts` fails when the skill uses an option `cliprobe --help` doesn't document, leaves out a check, or when the eval fixtures in `skills/evals/cliprobe/` no longer give the verdicts `evals.json` states. The skill states the oldest cliprobe it supports ("1.2 or later") and asks npx for that range; raise it when the skill starts relying on a newer option. See [skills/README.md](skills/README.md) for running the evals in an agent.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org), checked by commitlint. Keep commits small, one change each.

| Type                                               | Use it for                            | Releases        |
| -------------------------------------------------- | ------------------------------------- | --------------- |
| `feat`                                             | A new check, option or behavior       | A minor version |
| `fix`                                              | A bug fix                             | A patch version |
| `docs(readme)`                                     | A README change that should reach npm | A patch version |
| `docs`, `test`, `refactor`, `build`, `ci`, `chore` | Everything else                       | Nothing         |

A breaking change needs a `BREAKING CHANGE:` footer and waits for a major release. npm shows the README from the last published version, which is why a README fix that users should see is a `docs(readme)` commit. In a commit body, don't start a line with a single word followed by a colon: Git reads it as a trailer.

## Pull requests

- Fill in the pull request template, including how you verified the change.
- CI runs the quality checks and the test suite on Linux (Node.js 22, 24 and 26), macOS and Alpine. A change that only touches Markdown skips the test jobs.
- The maintainer reviews and merges with **rebase and merge**, never squash, so each commit keeps its own changelog entry.

## How releases work

Merging to `main` is the release. [semantic-release](https://github.com/semantic-release/semantic-release) reads the commits since the last tag, picks the version, updates `CHANGELOG.md`, creates the GitHub release and publishes to npm from CI through trusted publishing, with [provenance](https://docs.npmjs.com/generating-provenance-statements). Nobody publishes from a laptop. Dependabot's weekly updates use `build` and `ci` commits, so they ship with the next `feat` or `fix`.
