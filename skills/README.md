# Agent skill

[`cliprobe/`](cliprobe/SKILL.md) is the official [Agent Skill](https://agentskills.io) for cliprobe. It teaches coding agents to test a command-line program for terminal-edge bugs with evidence instead of guesses:

- **Check a CLI:** run every check in one go, with probes for a command that keeps running and one that prints file names, and report each failure with its evidence.
- **Name the program right:** an executable as users type it, or a script through `node` with the script in every probe.
- **Fix what failed:** the fix for each check in a Node.js CLI, applied only when asked, then the same run again.
- **Add it to CI:** a pinned `npx cliprobe@1` step with a job summary or JUnit XML.
- **Stay safe:** probe only the user's own or trusted programs and harmless commands, and anything else in a disposable container.

The skill drives the published CLI, version 1.2 or later (`cliprobe`, or `npx "cliprobe@^1.2"`), and reads its JSON report. It is a plain `SKILL.md` with two reference files, so it works in any agent that supports the Agent Skills format.

**Requirements:** Node.js 22.12 or later on macOS or Linux. If cliprobe 1.2 or later is not installed, the skill runs it through `npx`, which needs network access once.

## Install

### With the `skills` installer (any supported agent)

```bash
npx skills add KhaledSaeed18/cliprobe --skill cliprobe
```

It asks which agents to install for. Add `-g` to install for your user instead of the current project, or `-a <agent>` to choose agents up front (for example `-a claude-code -a codex`). Project installs go to `.agents/skills/`, which Codex, Gemini CLI, OpenCode, and GitHub Copilot read, plus a link in `.claude/skills/` for Claude Code.

### Gemini CLI

```bash
gemini skills install https://github.com/KhaledSaeed18/cliprobe.git --path skills/cliprobe
```

### Manually

Copy the `skills/cliprobe` folder into the folder your agent loads skills from:

| Agent                                       | Project           | User                           |
| ------------------------------------------- | ----------------- | ------------------------------ |
| Claude Code                                 | `.claude/skills/` | `~/.claude/skills/`            |
| Codex, Gemini CLI, OpenCode, GitHub Copilot | `.agents/skills/` | see your agent's documentation |
| Gemini CLI (also)                           | `.gemini/skills/` | `~/.gemini/skills/`            |

For example, for every project agent at once:

```bash
git clone --depth 1 https://github.com/KhaledSaeed18/cliprobe.git /tmp/cliprobe
mkdir -p .agents/skills && cp -R /tmp/cliprobe/skills/cliprobe .agents/skills/
```

Agents without Agent Skills support can still use it: add `skills/cliprobe/SKILL.md` to the agent's instructions or context.

## Use

Ask in your own words; the skill is picked by its description. For example:

- "My CLI crashes with EPIPE when I pipe it into head. Can you check what else is wrong?"
- "Before I publish this tool, test how it behaves in CI and when someone presses Ctrl-C."
- "Add a CI step that fails when our CLI prints color into a pipe."

## Evals

[`evals/cliprobe/`](evals/cliprobe/) holds the evaluation set; it is kept outside the skill folder so agents never see the expected answers.

- `make-fixtures.mjs` builds two versions of a small note-taking CLI: `notes-cli`, with seven failures across closed-pipe, color, ctrl-c and control-chars, and `notes-cli-fixed`, which passes. The programs only print, wait and list a directory; they write nothing and use no network. `--verify` checks afterwards that the agent changed nothing (or, in the fix eval, only `notes-cli/cli.js`).
- `evals.json` has four prompts with expected answers and checkable expectations (format of the skill-creator tooling): finding the bugs, confirming the fix, a CI step, and fixing one failure.
- `trigger-queries.json` lists requests that should and should not activate the skill.

`test/skill.test.ts` checks the skill on every test run: its frontmatter, that its links resolve, that it only uses options `cliprobe --help` documents, and that the fixtures still give the verdicts `evals.json` states. It doesn't check how an agent behaves; for that, run the evals in the agent:

1. `node skills/evals/cliprobe/make-fixtures.mjs /tmp/cliprobe-evals`
2. Install the skill for the agent (see above), start it in a scratch project, and give it each prompt with `{fixtures}` replaced by `/tmp/cliprobe-evals`, without naming the skill.
3. Grade the answer against the expectations, and run `node skills/evals/cliprobe/make-fixtures.mjs --verify /tmp/cliprobe-evals`.

The skill hasn't been run through the evals in an agent yet; results will be listed here once it has.
