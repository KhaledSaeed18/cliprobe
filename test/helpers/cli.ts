import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT: string = fileURLToPath(new URL('../..', import.meta.url));
export const BIN: string = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export const fixture = (name: string): string =>
    fileURLToPath(new URL(`../fixtures/${name}.mjs`, import.meta.url));

export interface CliResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/** Runs the built cliprobe with the given arguments. */
export function cliprobe(args: readonly string[], cwd?: string): CliResult {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
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

/** Runs cliprobe --json on a command and parses the report. */
export function probeJson(
    command: readonly string[],
    cwd?: string
): { status: number | null; report: Report } {
    const r = cliprobe(['--json', '--timeout', '3000', '--', ...command], cwd);
    return { status: r.status, report: JSON.parse(r.stdout) as Report };
}

/** The first result, failing the test loudly if there is none. */
export function first(report: Report): JsonResult {
    const result = report.results[0];
    if (!result) throw new Error(`no results in report: ${JSON.stringify(report)}`);
    return result;
}
