import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fileURLToPath } from 'node:url';
import { CHECKS } from '../../src/checks/index.ts';
import { run } from '../../src/cli/program.ts';
import { createFixture, expandFixture, usesFixture } from '../../src/core/fixture.ts';
import type { Result } from '../../src/core/types.ts';

export const ROOT: string = fileURLToPath(new URL('../..', import.meta.url));
export const BIN: string = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export const fixture = (name: string): string =>
    fileURLToPath(new URL(`../fixtures/${name}.mjs`, import.meta.url));

/**
 * Command lines of the running processes that `match` accepts: lines such as
 * `sleep 71`, or ending with a fixture child's marker comment. Zombies are left
 * out, as cliprobe leaves them out.
 */
export function running(match: (args: string) => boolean): string[] {
    return execFileSync('ps', ['-axo', 'stat=,args='], { encoding: 'utf8' })
        .split('\n')
        .map((line) => /^\s*(\S+)\s+(.*?)\s*$/.exec(line))
        .filter((m): m is RegExpExecArray => m !== null && !(m[1] ?? '').startsWith('Z'))
        .map((m) => m[2] ?? '')
        .filter(match);
}

/** Whether a process's arguments end with `marker`. */
export const endsWith =
    (marker: string) =>
    (args: string): boolean =>
        args.endsWith(marker);

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
    /** The check's own fields; tests read them with their own types. */
    details: Record<string, unknown>;
}

export interface Report {
    tool: string;
    schemaVersion: number;
    version: string;
    command: string;
    checks: string[];
    summary: Record<string, number>;
    results: JsonResult[];
}

interface SchemaNode {
    properties?: Record<string, SchemaNode>;
    items?: SchemaNode;
    $ref?: string;
}

export const SCHEMA: Record<string, unknown> & { $defs: Record<string, SchemaNode> } = JSON.parse(
    readFileSync(new URL('../../schema.json', import.meta.url), 'utf8')
) as Record<string, unknown> & { $defs: Record<string, SchemaNode> };
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(SCHEMA);

/**
 * Fields the schema doesn't declare. The schema allows them, so a 1.x report
 * still validates against an older schema; the tests make sure none slip in.
 */
export function undeclared(value: unknown, node: SchemaNode, path = '$'): string[] {
    const target = node.$ref ? SCHEMA.$defs[node.$ref.replace('#/$defs/', '')] : node;
    if (!target || value === null || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
        const items = target.items;
        return items ? value.flatMap((v, i) => undeclared(v, items, `${path}[${i}]`)) : [];
    }
    if (!target.properties) return [];
    return Object.entries(value).flatMap(([key, v]) => {
        const child = target.properties?.[key];
        return child ? undeclared(v, child, `${path}.${key}`) : [`${path}.${key}`];
    });
}

/** Throws unless the report matches schema.json and declares every field it has. */
export function assertValidReport(report: unknown): void {
    if (!validate(report)) {
        throw new Error(`report does not match schema.json: ${JSON.stringify(validate.errors)}`);
    }
    const r = report as Report;
    const extra = [
        ...undeclared({ ...r, results: [] }, SCHEMA as SchemaNode),
        ...r.results.flatMap((res, i) => [
            ...undeclared({ ...res, details: {} }, SCHEMA.$defs['result'] ?? {}, `$.results[${i}]`),
            ...undeclared(
                res.details,
                SCHEMA.$defs[`details.${res.check}`] ?? {},
                `$.results[${i}].details`
            ),
        ]),
    ];
    if (extra.length) throw new Error(`fields missing from schema.json: ${extra.join(', ')}`);
}

export interface ProbeOptions {
    cwd?: string;
    /** Only these checks; all of them when left out. */
    checks?: readonly string[];
    timeout?: number;
    /** Extra probes, each passed as one --probe string. */
    probes?: readonly string[];
}

/** Runs cliprobe --json on a command and parses the report. */
export async function probeJson(
    command: readonly string[],
    { cwd, checks = [], timeout = 3000, probes = [] }: ProbeOptions = {}
): Promise<{ status: number | null; report: Report }> {
    const checkArgs = checks.length ? ['--check', checks.join(',')] : [];
    const probeArgs = probes.flatMap((p) => ['--probe', p]);
    const r = await cliprobe(
        ['--json', '--timeout', String(timeout), ...checkArgs, ...probeArgs, '--', ...command],
        cwd
    );
    const report = JSON.parse(r.stdout) as Report;
    assertValidReport(report);
    return { status: r.status, report };
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
                probes: args.length
                    ? [{ args: f ? expandFixture(args, f.dir) : args, own: true }]
                    : [
                          { args: ['--version'], own: false },
                          { args: ['--help'], own: false },
                      ],
                ...(f ? { fixtureDir: f.dir } : {}),
            },
            { timeout }
        );
    } finally {
        f?.cleanup();
    }
}
