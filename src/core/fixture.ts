import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result } from './types.ts';

/** Written in probe arguments; replaced with the path of a directory of hostile file names. */
export const FIXTURE_PLACEHOLDER = '{fixture}';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const C1_CSI = String.fromCharCode(0x9b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);

/** How bad it is when a name reaches a terminal unescaped. */
export type Severity = 'fail' | 'warn' | 'note';

export interface HostileName {
    kind: string;
    /** The file name as created. */
    name: string;
    /** The part of the name that shows it was printed raw. */
    marker: string;
    /** What the dangerous part is, for reports. */
    label: string;
    severity: Severity;
}

/**
 * File names a program may print. ESC sequences can drive the terminal (fail);
 * C1 controls, carriage returns and newlines can hide or forge output (warn); a
 * bidirectional override reorders text, but GNU ls and find print it raw too
 * (note only).
 */
export const HOSTILE_NAMES: readonly HostileName[] = [
    {
        kind: 'osc',
        name: `title-${ESC}]0;cliprobe${BEL}.txt`,
        marker: `${ESC}]0;cliprobe${BEL}`,
        label: 'an escape sequence that sets the window title',
        severity: 'fail',
    },
    {
        kind: 'csi',
        name: `clear-${ESC}[2J.txt`,
        marker: `${ESC}[2J`,
        label: 'an escape sequence that clears the screen',
        severity: 'fail',
    },
    {
        kind: 'c1',
        name: `c1-${C1_CSI}2J.txt`,
        marker: `${C1_CSI}2J`,
        label: 'a C1 control character',
        severity: 'warn',
    },
    {
        kind: 'cr',
        name: 'cr-\rspoof.txt',
        marker: 'cr-\rspoof',
        label: 'a carriage return',
        severity: 'warn',
    },
    {
        kind: 'newline',
        name: 'nl-\nspoof.txt',
        marker: 'nl-\nspoof',
        label: 'a newline',
        severity: 'warn',
    },
    {
        kind: 'bidi',
        name: `bidi-${RIGHT_TO_LEFT_OVERRIDE}txt.exe`,
        marker: `${RIGHT_TO_LEFT_OVERRIDE}txt`,
        label: 'a bidirectional override',
        severity: 'note',
    },
];

/** An ordinary name; seeing it in the output shows the program listed the directory. */
export const PLAIN_NAME = 'plain.txt';

export interface Fixture {
    dir: string;
    /** `dir` with symlinks resolved (/private/var on macOS), as some programs print it. */
    realDir: string;
    cleanup(): void;
}

/** Creates a temporary directory holding the hostile names and one plain file. */
export function createFixture(): Fixture {
    const dir = mkdtempSync(join(tmpdir(), 'cliprobe-fixture-'));
    for (const { name } of HOSTILE_NAMES) writeFileSync(join(dir, name), '');
    writeFileSync(join(dir, PLAIN_NAME), '');
    return {
        dir,
        realDir: realpathSync(dir),
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
}

export function usesFixture(args: readonly string[]): boolean {
    return args.some((a) => a.includes(FIXTURE_PLACEHOLDER));
}

/** Replaces the placeholder in every argument, including inside `--dir={fixture}`. */
export function expandFixture(args: readonly string[], dir: string): string[] {
    return args.map((a) => a.replaceAll(FIXTURE_PLACEHOLDER, dir));
}

/**
 * Puts the placeholder back wherever the fixture's path appears in report text,
 * so reports show {fixture} rather than a path that no longer exists.
 */
export function collapseFixture(text: string, fixture: Fixture): string {
    // realDir first: on macOS it contains dir (/private/var/... vs /var/...).
    return text
        .replaceAll(fixture.realDir, FIXTURE_PLACEHOLDER)
        .replaceAll(fixture.dir, FIXTURE_PLACEHOLDER);
}

/**
 * Removes the hostile names' dangerous parts from output, for checks other than
 * control-chars: a lister that prints them raw into a pipe is doing its job, and
 * control-chars judges how they reach a terminal.
 */
export function withoutHostileNames(text: string): string {
    let out = text;
    for (const { marker } of HOSTILE_NAMES) out = out.replaceAll(marker, '');
    return out;
}

function collapseValue(value: unknown, fixture: Fixture): unknown {
    if (typeof value === 'string') return collapseFixture(value, fixture);
    if (Array.isArray(value)) return value.map((v: unknown) => collapseValue(v, fixture));
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, collapseValue(v, fixture)])
        );
    }
    return value;
}

/** collapseFixture applied to every string in the results: invocation, reason, evidence and data. */
export function collapseResults(results: readonly Result[], fixture: Fixture): Result[] {
    return results.map((r) => {
        const data = Object.fromEntries(
            Object.entries(r).map(([k, v]) => [k, collapseValue(v, fixture)])
        );
        const c = (text: string): string => collapseFixture(text, fixture);
        return {
            ...data,
            check: r.check,
            invocation: r.invocation.map(c),
            verdict: r.verdict,
            reason: c(r.reason),
            ...(r.evidence === undefined ? {} : { evidence: c(r.evidence) }),
        };
    });
}
