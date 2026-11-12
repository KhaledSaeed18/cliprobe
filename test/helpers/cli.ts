import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHECKS } from '../../src/checks/index.ts';
import { run } from '../../src/cli/program.ts';
import { createFixture, expandFixture, usesFixture } from '../../src/core/fixture.ts';
import type { Result } from '../../src/core/types.ts';

export const ROOT: string = fileURLToPath(new URL('../..', import.meta.url));
export const BIN: string = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export const fixture = (name: string): string =>
    fileURLToPath(new URL(`../fixtures/${name}.mjs`, import.meta.url));

export interface CliResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/** Runs the built cliprobe as a real process: the published file, its real exit code and streams. */
export function cliprobeBin(
    args: readonly string[],
    cwd?: string,
    env?: NodeJS.ProcessEnv
): CliResult {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd, env });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Runs cliprobe in this process through run(argv, io), so coverage sees its code.
 * A different cwd or environment can't apply in-process, so those run the built
 * file instead.
 */
export async function cliprobe(
    args: readonly string[],
    cwd?: string,
    env?: NodeJS.ProcessEnv
): Promise<CliResult> {
    if (cwd !== undefined || env !== undefined) return cliprobeBin(args, cwd, env);
    let stdout = '';
    let stderr = '';
    const status = await run(args, {
        stdout: (text) => {
            stdout += text;
        },
        stderr: (text) => {
            stderr += text;
        },
        color: false,
        platform: process.platform,
    });
    return { status, stdout, stderr };
}

export interface JsonResult {
    check: string;
    verdict: string;
    reason: string;
    evidence?: string;
    invocation: string[];
    closed: { signal: string | null; timedOut: boolean };
}

export interface Report {
    tool: string;
    version: string;
    command: string;
    checks: string[];
    results: JsonResult[];
}

export interface ProbeOptions {
    cwd?: string;
    /** Only these checks; all of them when left out. */
    checks?: readonly string[];
    timeout?: number;
}

/** Runs cliprobe --json on a command and parses the report. */
export async function probeJson(
    command: readonly string[],
    { cwd, checks = [], timeout = 3000 }: ProbeOptions = {}
): Promise<{ status: number | null; report: Report }> {
    const checkArgs = checks.length ? ['--check', checks.join(',')] : [];
    const r = await cliprobe(
        ['--json', '--timeout', String(timeout), ...checkArgs, '--', ...command],
        cwd
    );
    return { status: r.status, report: JSON.parse(r.stdout) as Report };
}

/** The first result, failing the test loudly if there is none. */
export function first(report: Report): JsonResult {
    const result = report.results[0];
    if (!result) throw new Error(`no results in report: ${JSON.stringify(report)}`);
    return result;
}

/**
 * Runs one check directly, without the CLI around it: for cases the CLI stops
 * before any check runs, such as a command that isn't on PATH.
 */
export async function runCheck(
    name: string,
    [command = '', ...args]: readonly string[],
    timeout = 3000
): Promise<Result[]> {
    const check = CHECKS.find((c) => c.name === name);
    if (!check) throw new Error(`no check named ${name}`);
    const f = usesFixture(args) ? createFixture() : undefined;
    try {
        return await check.run(
            {
                command,
                explicit: args.length > 0,
                invocations: args.length
                    ? [f ? expandFixture(args, f.dir) : args]
                    : [['--version'], ['--help']],
                ...(f ? { fixtureDir: f.dir } : {}),
            },
            { timeout }
        );
    } finally {
        f?.cleanup();
    }
}
