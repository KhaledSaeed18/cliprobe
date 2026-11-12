import { CHECKS, selectChecks } from '../checks/index.ts';
import { collapseResults, createFixture, expandFixture, usesFixture } from '../core/fixture.ts';
import { safe } from '../core/safe.ts';
import { findCommand } from '../core/which.ts';
import type { Result, Target } from '../core/types.ts';
import { FORMATS, type Report } from '../report/index.ts';
import { writeReportFile } from '../report/write.ts';
import { VERSION } from '../version.ts';
import { parseArgs, UsageError } from './args.ts';
import { HELP } from './help.ts';

/** Everything the CLI takes from the process, so tests can run it in-process. */
export interface CliIO {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    /** Color verdict labels in the human report (stdout is a terminal, NO_COLOR unset). */
    color: boolean;
    platform: NodeJS.Platform;
}

/** 0 no failures, 1 a check failed, 2 nothing could be judged because something could not run. */
export function exitCodeFor(results: readonly Result[]): number {
    if (results.some((r) => r.verdict === 'fail')) return 1;
    const judged = results.some((r) => r.verdict !== 'error' && r.verdict !== 'skip');
    if (!judged && results.some((r) => r.verdict === 'error')) return 2;
    return 0;
}

/** The whole CLI: parses argv, runs the checks, reports, and returns the exit code. */
export async function run(argv: readonly string[], io: CliIO): Promise<number> {
    const out = io.stdout;
    const err = io.stderr;
    let opts;
    try {
        opts = parseArgs(argv);
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
    if (io.platform === 'win32') {
        err('cliprobe: Windows is not supported yet (the closed-pipe check needs mkfifo).\n');
        return 2;
    }

    // Every check would only say it could not start the command, so say it once.
    if (findCommand(opts.command) === undefined) {
        err(`cliprobe: command not found: ${safe(opts.command)}\n`);
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
    // Report the placeholder, not a temporary path that no longer exists. Collapse
    // before formatting, so column widths fit the text that is shown.
    const report: Report = {
        version: VERSION,
        command: opts.command,
        checks: checks.map((c) => c.name),
        results: fixture ? collapseResults(results, fixture) : results,
    };
    const { color } = io;
    if (opts.outputFile) {
        try {
            writeReportFile(opts.outputFile, FORMATS[opts.format](report, { color: false }));
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            err(`cliprobe: could not write ${safe(opts.outputFile)}: ${safe(reason)}\n`);
            return 2;
        }
        out(FORMATS.human(report, { color }));
    } else {
        out(FORMATS[opts.format](report, { color }));
    }
    return exitCodeFor(results);
}
