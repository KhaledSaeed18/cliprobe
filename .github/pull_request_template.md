## Summary

<!-- What this changes and why. Link the issue it resolves, e.g. "Closes #123". -->

## Type of change

<!-- The commit type decides the release: feat = minor, fix and docs(readme) = patch, anything else = no release. -->

- [ ] `feat`: a new check, option or behavior
- [ ] `fix`: a bug fix
- [ ] `docs`: documentation only (`docs(readme)` to publish the README to npm)
- [ ] `test`, `refactor`, `build`, `ci` or `chore`

## Contract

<!-- The 1.x stability promise: https://github.com/KhaledSaeed18/cliprobe#stability -->

- [ ] No new way to fail. A new check, or a new way for a check to fail, only warns.
- [ ] Check names, verdicts, options and exit codes are unchanged.
- [ ] The JSON report only gains fields, and `schema.json` declares each new one.
- [ ] Every piece of text from the probed program is escaped in every output format.

<!-- If a box doesn't hold, say why here. A breaking change needs a BREAKING CHANGE footer and waits for the next major. -->

## Kept in sync

<!-- Tick what this change touched, or strike through what doesn't apply. -->

- [ ] `src/cli/help.ts`: the check list, options and descriptions
- [ ] `schema.json`: new `details` fields, or a new check's name and `details.<check>` entry
- [ ] `README.md`: usage, options, the number of checks, check sections and verdict tables, "In CI", "Fixing a failure", "Safety"
- [ ] `AGENTS.md` and `CONTRIBUTING.md`: layout, commands, rules or workflow
- [ ] `.github/ISSUE_TEMPLATE/wrong_verdict.yml`: the check list
- [ ] Tests and fixtures: pass, warn, fail and skip cases, and real tools that must not fail
- [ ] `package.json` `description` and `keywords`, if the scope changed

## Verification

<!-- How you know it works. -->

- [ ] `pnpm check` passes
- [ ] Tested on: <!-- macOS, Linux, Alpine -->
- [ ] For a check change: calibrated against real tools in a disposable container with `--network none` (which tools, and the result)
