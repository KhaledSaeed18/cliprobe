import { run, type RunResult } from '../core/run.ts';
import type { Check, Result } from '../core/types.ts';

/** A flag no real program defines. */
export const UNKNOWN_FLAG = '--cliprobe-unknown-flag';
/** A program that ignores unknown flags may start its default action; don't wait long. */
const UNKNOWN_FLAG_TIMEOUT_MS = 5000;

export interface BaselineResult extends Result {
    exitCode: number | null;
    stdoutLines: number;
    stderrLines: number;
}

const lines = (text: string): string[] => text.split('\n').filter((l) => l.trim() !== '');
/** The first line printed, labelled with its stream, as evidence. */
function firstLine(r: RunResult): string {
    const out = lines(r.stdout.toString('utf8'))[0];
    if (out !== undefined) return `stdout: ${out}`;
    const err = lines(r.stderr)[0];
    return err === undefined ? '' : `stderr: ${err}`;
}
const exitText = (r: RunResult): string =>
    r.signal ? `was stopped by ${r.signal}` : `exited ${r.exitCode}`;

/** Each describes one convention scripts and agents rely on; observations, never verdicts. */
export function describeVersion(r: RunResult): { reason: string; evidence?: string } {
    const out = lines(r.stdout.toString('utf8'));
    if (r.exitCode !== 0) {
        return { reason: `${exitText(r)}; there may be no --version`, evidence: firstLine(r) };
    }
    if (out.length === 1) return { reason: 'printed one line to stdout', evidence: out[0] ?? '' };
    if (out.length > 1) {
        return {
            reason: `printed ${out.length} lines to stdout; one line is easier for scripts to parse`,
            evidence: `first line: ${out[0] ?? ''}`,
        };
    }
    if (lines(r.stderr).length) {
        return { reason: 'printed the version to stderr, not stdout', evidence: firstLine(r) };
    }
    return { reason: 'printed nothing' };
}

export function describeHelp(r: RunResult): { reason: string; evidence?: string } {
    const out = lines(r.stdout.toString('utf8'));
    const err = lines(r.stderr);
    if (out.length && r.exitCode === 0) {
        return { reason: `printed ${out.length} lines to stdout and exited 0` };
    }
    if (out.length) return { reason: `printed help to stdout but ${exitText(r)}` };
    if (err.length) {
        return {
            reason: `printed help to stderr and ${exitText(r)}, so "--help | less" and agents reading stdout get nothing`,
        };
    }
    return { reason: `printed nothing and ${exitText(r)}` };
}

export function describeUnknownFlag(r: RunResult): { reason: string; evidence?: string } {
    if (r.timedOut) {
        return {
            reason: `still running after ${UNKNOWN_FLAG_TIMEOUT_MS / 1000} s; it may have ignored the flag and started its default action`,
        };
    }
    const evidence = firstLine(r);
    const withEvidence = (reason: string): { reason: string; evidence?: string } =>
        evidence ? { reason, evidence } : { reason };
    if (r.exitCode === 0) {
        return withEvidence('exited 0, so a script cannot tell the flag was wrong');
    }
    const out = lines(r.stdout.toString('utf8'));
    if (out.length) {
        return withEvidence(`${exitText(r)}, but printed its message to stdout rather than stderr`);
    }
    if (lines(r.stderr).length) return withEvidence(`${exitText(r)} with its message on stderr`);
    return { reason: `${exitText(r)} without saying why` };
}

async function probe(
    command: string,
    args: string[],
    timeout: number,
    describe: (r: RunResult) => { reason: string; evidence?: string }
): Promise<BaselineResult> {
    const r = await run(command, args, { timeout });
    const base = { check: 'baseline', invocation: [command, ...args] };
    if (r.spawnError) {
        return {
            ...base,
            verdict: 'error',
            reason: `could not start: ${r.spawnError}`,
            exitCode: null,
            stdoutLines: 0,
            stderrLines: 0,
        };
    }
    const { reason, evidence } =
        r.timedOut && describe !== describeUnknownFlag
            ? { reason: 'timed out', evidence: undefined }
            : describe(r);
    return {
        ...base,
        verdict: 'info',
        reason,
        ...(evidence ? { evidence } : {}),
        exitCode: r.exitCode,
        stdoutLines: lines(r.stdout.toString('utf8')).length,
        stderrLines: lines(r.stderr).length,
    };
}

export const baselineCheck: Check = {
    name: 'baseline',
    kind: 'info',
    summary: '--version prints one line, --help goes to stdout, an unknown flag exits non-zero',
    async run(target, ctx) {
        // With probe args, they are the program: `node ./dist/cli.js` gets the flags appended.
        const prefix = target.explicit ? (target.invocations[0] ?? []) : [];
        return [
            await probe(target.command, [...prefix, '--version'], ctx.timeout, describeVersion),
            await probe(target.command, [...prefix, '--help'], ctx.timeout, describeHelp),
            await probe(
                target.command,
                [...prefix, UNKNOWN_FLAG],
                Math.min(ctx.timeout, UNKNOWN_FLAG_TIMEOUT_MS),
                describeUnknownFlag
            ),
        ];
    },
};
