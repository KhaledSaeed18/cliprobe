# Security policy

## Supported versions

cliprobe follows [semantic versioning](https://semver.org). Security fixes go into the latest 1.x release. Upgrading within 1.x is safe by design: the [stability promise](https://github.com/KhaledSaeed18/cliprobe#stability) keeps check names, options, exit codes and the JSON report compatible.

| Version | Supported                     |
| ------- | ----------------------------- |
| 1.x     | Yes, the latest minor release |
| < 1.0   | No. Upgrade to 1.x            |

## Reporting a vulnerability

**Please don't report vulnerabilities in public issues, discussions or pull requests.**

Report them privately through GitHub: open the repository's [Security tab and choose "Report a vulnerability"](https://github.com/KhaledSaeed18/cliprobe/security/advisories/new). Only the maintainer can see the report. If you can't use GitHub, email [khaled18saeed@gmail.com](mailto:khaled18saeed@gmail.com) with "cliprobe security" in the subject.

A useful report includes:

- the cliprobe version (`cliprobe --version`), your OS and your Node.js version,
- the exact cliprobe command and, if it matters, the program you probed,
- what happened and what an attacker gains from it,
- a minimal reproduction, such as a small program whose output triggers the problem.

## What happens next

cliprobe is maintained by one person, so these are goals, not guarantees:

- an acknowledgement within 3 working days,
- an assessment, and a plan or a reason for declining, within 10 working days,
- a fix released as soon as it is ready, with a [GitHub security advisory](https://github.com/KhaledSaeed18/cliprobe/security/advisories) and a CVE where one applies.

Please keep the report private until the fix is released. You'll be credited in the advisory unless you ask not to be.

## Scope

cliprobe runs programs and prints what they did, so the line between its own bugs and the probed program's behavior matters.

**In scope**, as vulnerabilities in cliprobe:

- **Output injection.** Text from a probed program reaching your terminal, or a CI system's renderer, unescaped. cliprobe escapes target text in every format: control characters in the human report, JSON escaping, Markdown code spans and XML in JUnit. A file name or output line that gets through, for example to move the cursor, change the window title or forge a passing result, is a vulnerability.
- **Sandbox escapes.** cliprobe gives the program a minimal environment (`PATH`, `LANG`, `TERM`, `CI` and a temporary `HOME` and `TMPDIR`) and no shell. A variable from your shell, such as a token, reaching the program is a vulnerability.
- **Unexpected input or arguments.** cliprobe passes only the arguments you give it, and the only input it sends is Ctrl-C or SIGTERM where a check needs it. Anything else it sends, writes or runs is a vulnerability.
- **Processes left running.** cliprobe kills each run's process group on timeout, kills whatever a program leaves running when it exits, and stops its probes and removes its temporary directories and any half-written report file when it is itself stopped by Ctrl-C, SIGTERM or SIGHUP. Processes surviving a finished cliprobe run because of cliprobe are a bug, and a security issue where they keep running with your privileges.
- **The release pipeline.** Anything that could let someone other than the maintainer publish a version of cliprobe to npm.

**Out of scope:**

- **What the probed program does.** cliprobe executes the program you name, with your privileges, in your current directory, as the [Safety](https://github.com/KhaledSaeed18/cliprobe#safety) section of the README says. Probing an untrusted program is like running it. Run untrusted programs in a disposable container.
- **Bugs that cliprobe finds.** A crash on a closed pipe or an escape sequence in a pipe is a finding about the probed program; report it to that program's maintainers.
- **Development dependencies.** cliprobe has no runtime dependencies. Advisories in dev tooling don't reach users unless they affect the published file; Dependabot handles them.

## Verifying a release

Every version from 0.1.0 on is published from GitHub Actions through npm trusted publishing, with a signed [provenance statement](https://docs.npmjs.com/generating-provenance-statements) that ties the package to the commit and workflow that built it. To check what you installed:

```sh
npm audit signatures
```

The package's npm page also shows the provenance under "Provenance".
