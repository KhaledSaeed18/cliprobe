#!/usr/bin/env node
// cliprobe: black-box tests a command-line program for terminal-edge bugs.
import { CHECKS, selectChecks } from '../checks/index.ts';
import type { Result, Target } from '../core/types.ts';
import { formatHuman } from '../report/human.ts';
import { formatJson } from '../report/json.ts';
import { VERSION } from '../version.ts';
import { parseArgs, UsageError } from './args.ts';

const HELP = `cliprobe ${VERSION}: test a command-line program for terminal-edge bugs

Usage:
  cliprobe [options] -- <command> [args...]

With no args after <command>, cliprobe probes "<command> --version" and
"<command> --help". With args, it probes exactly that invocation.

Checks:
  closed-pipe   Runs the command with stdout already closed, as when output is
                piped into a reader that quits early (head, grep -q, an agent).
                A well-behaved program exits quietly; a buggy one crashes with
                an EPIPE error and a stack trace.

Options:
  --check <name>     Run only this check; repeat it or use commas for several
  --json             Print results as JSON
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

    const target: Target = {
        command: opts.command,
        invocations: opts.args.length ? [opts.args] : [['--version'], ['--help']],
    };
    const results: Result[] = [];
    for (const check of checks) {
        results.push(...(await check.run(target, { timeout: opts.timeout })));
    }

    if (opts.json) {
        out(
            formatJson(
                VERSION,
                opts.command,
                checks.map((c) => c.name),
                results
            )
        );
    } else {
        const useColor = process.stdout.isTTY && !process.env['NO_COLOR'];
        out(
            formatHuman(
                VERSION,
                opts.command,
                checks.map((c) => c.name),
                results,
                useColor
            )
        );
    }
    if (results.some((r) => r.verdict === 'fail')) return 1;
    if (results.every((r) => r.verdict === 'error')) return 2;
    return 0;
}

// cliprobe practises what it checks: a closed stdout ends it quietly.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
});

process.exitCode = await main();
