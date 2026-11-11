#!/usr/bin/env node
// cliprobe: black-box tests a command-line program for terminal-edge bugs.
import { CHECKS, selectChecks } from '../checks/index.ts';
import { collapseFixture, createFixture, expandFixture, usesFixture } from '../core/fixture.ts';
import type { Result, Target } from '../core/types.ts';
import { FORMATS, type Report } from '../report/index.ts';
import { writeReportFile } from '../report/write.ts';
import { safe } from '../core/safe.ts';
import { VERSION } from '../version.ts';
import { parseArgs, UsageError } from './args.ts';

const HELP = `cliprobe ${VERSION}: test a command-line program for terminal-edge bugs

Usage:
  cliprobe [options] -- <command> [args...]

With no args after <command>, cliprobe probes "<command> --version" and
"<command> --help". With args, it probes exactly that invocation. An argument
containing {fixture} gets the path of a temporary directory of file names with
control characters in them, for the control-chars check.

Checks:
  closed-pipe   Runs the command with stdout already closed, as when output is
                piped into a reader that quits early (head, grep -q, an agent).
                A well-behaved program exits quietly; a buggy one crashes with
                an EPIPE error and a stack trace.
  color         Runs the command into a pipe, then under a terminal, then under
                a terminal with NO_COLOR=1. Fails if color codes reach a pipe;
                warns if color goes to a piped stderr or NO_COLOR is ignored.
  ctrl-c        Sends Ctrl-C (SIGINT) after 1 s. Fails if the command is still
                running 3 s later or prints a stack trace; warns if it exits 0.
                Skipped when the command finishes first, so probe a command
                that keeps running (a watcher, a server, a long task).
  control-chars Runs the command under a terminal with {fixture} replaced by a
                directory of file names holding escape sequences, a carriage
                return, a newline and more. Fails if an escape sequence reaches
                the terminal unescaped; warns for the others. Skipped without
                {fixture}, e.g. cliprobe -- ls {fixture}

Info checks (never fail; run only when named with --check):
  startup       Median wall time over 5 runs of "<command> --version", or of the
                probe as given, e.g. cliprobe --check startup -- node cli.js -v
  baseline      Appends --version, --help and an unknown flag to the probe and
                reports what scripts rely on: one version line, help on stdout,
                non-zero exit for a bad flag. A program that ignores unknown
                flags runs its default action, cut off after 5 s.

Options:
  --check <name>     Run only this check; repeat it or use commas for several
  --format <name>    Output format: human (default), json, markdown (a CI job
                     summary or PR comment) or junit (XML for CI test reports)
  --json             Same as --format json
  -o, --output-file <path>
                     Write the --format report to a file (created atomically,
                     with parent folders); the human report still prints
  --timeout <ms>     Kill a probe after this long (default 15000)
  -h, --help         Show this help
  -v, --version      Show the version

Exit codes: 0 no failures, 1 a check failed, 2 usage error or could not run.
Runs the target in the current directory without a shell, with stdin closed,
a temporary HOME and a minimal environment. Only run programs you trust.`;

const out = (text: string): void => {
    process.stdout.write(text);
};
const err = (text: string): void => {
    process.stderr.write(text);
};

async function main(): Promise<number> {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        err(`cliprobe: ${error.message}\nRun "cliprobe --help" for usage.\n`);
        return 2;
    }
    if (opts.help) {
        out(HELP + '\n');
        return 0;
    }
    if (opts.version) {
        out(VERSION + '\n');
        return 0;
    }
    const { checks, unknown } = selectChecks(opts.checks);
    if (unknown.length) {
        const available = CHECKS.map((c) => c.name).join(', ');
        const quoted = unknown.map((n) => `"${n}"`).join(', ');
        err(`cliprobe: unknown check ${quoted} (available: ${available})\n`);
        return 2;
    }
    if (!opts.command) {
        err('cliprobe: no command given\nUsage: cliprobe [options] -- <command> [args...]\n');
        return 2;
    }
    if (process.platform === 'win32') {
        err('cliprobe: Windows is not supported yet (the closed-pipe check needs mkfifo).\n');
        return 2;
    }

    const invocations = opts.args.length ? [opts.args] : [['--version'], ['--help']];
    const fixture = usesFixture(opts.args) ? createFixture() : undefined;
    const results: Result[] = [];
    try {
        const target: Target = {
            command: opts.command,
            explicit: opts.args.length > 0,
            invocations: fixture
                ? invocations.map((a) => expandFixture(a, fixture.dir))
                : invocations,
            ...(fixture ? { fixtureDir: fixture.dir } : {}),
        };
        for (const check of checks) {
            results.push(...(await check.run(target, { timeout: opts.timeout })));
        }
    } finally {
        fixture?.cleanup();
    }
    // Report the placeholder, not a temporary path that no longer exists.
    const collapse = (text: string): string => (fixture ? collapseFixture(text, fixture) : text);
    const report: Report = {
        version: VERSION,
        command: opts.command,
        checks: checks.map((c) => c.name),
        results,
    };
    const color = process.stdout.isTTY && !process.env['NO_COLOR'];
    if (opts.outputFile) {
        try {
            writeReportFile(
                opts.outputFile,
                collapse(FORMATS[opts.format](report, { color: false }))
            );
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            err(`cliprobe: could not write ${safe(opts.outputFile)}: ${safe(reason)}\n`);
            return 2;
        }
        out(collapse(FORMATS.human(report, { color })));
    } else {
        out(collapse(FORMATS[opts.format](report, { color })));
    }
    if (results.some((r) => r.verdict === 'fail')) return 1;
    // Could not run, and no check got far enough to judge anything.
    const judged = results.some((r) => r.verdict !== 'error' && r.verdict !== 'skip');
    if (!judged && results.some((r) => r.verdict === 'error')) return 2;
    return 0;
}

// cliprobe practises what it checks: a closed stdout ends it quietly.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
});

process.exitCode = await main();
