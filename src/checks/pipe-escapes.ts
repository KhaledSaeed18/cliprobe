import { CONTROL_LABELS, type ControlHit, type ControlKind, findControls } from '../core/ansi.ts';
import { withoutHostileNames } from '../core/fixture.ts';
import { markLongRunning, probeTimeout, stillRunning } from '../core/long-running.ts';
import { run, type RunResult } from '../core/run.ts';
import type { Check, Context, Judgement, Result } from '../core/types.ts';

/** As in the color check: a capable TERM, so a program can't pass by seeing TERM=dumb, and no CI. */
const ENV = { TERM: 'xterm-256color', CI: undefined } as const;

export interface PipeEscapesResult extends Result {
    /** Kinds of control code found on each stream, without repeats. */
    stdoutKinds: ControlKind[];
    stderrKinds: ControlKind[];
}

const kindsOf = (hits: readonly ControlHit[]): ControlKind[] => [
    ...new Set(hits.map((h) => h.kind)),
];

function listLabels(kinds: readonly ControlKind[]): string {
    const labels = kinds.map((k) => CONTROL_LABELS[k]);
    return labels.length <= 1
        ? (labels[0] ?? '')
        : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}

export function judgePipeEscapes(r: RunResult): Judgement {
    if (r.spawnError) return { verdict: 'error', reason: `could not start: ${r.spawnError}` };
    const stdout = r.stdout.toString('utf8');
    const outHits = findControls(stdout);
    const errHits = findControls(r.stderr);
    const first = outHits[0]
        ? { stream: 'stdout', hit: outHits[0] }
        : errHits[0] && { stream: 'stderr', hit: errHits[0] };
    if (first) {
        const kinds = [...new Set([...kindsOf(outHits), ...kindsOf(errHits)])];
        return {
            verdict: 'warn',
            reason: `printed terminal control codes into a pipe: ${listLabels(kinds)}`,
            evidence: `${first.stream} line ${first.hit.line}: ${first.hit.text}`,
        };
    }
    if (!stdout && !r.stderr) {
        return r.timedOut
            ? {
                  verdict: 'skip',
                  reason: `${stillRunning(r.durationMs)} and printed nothing so far`,
              }
            : { verdict: 'skip', reason: 'printed nothing, so there is nothing to check' };
    }
    // A program still running at the timeout is judged on what it printed by then.
    if (r.timedOut) {
        return {
            verdict: 'pass',
            reason: `no cursor, erase, hyperlink, title or redraw codes in a pipe (${stillRunning(r.durationMs)})`,
        };
    }
    return {
        verdict: 'pass',
        reason: 'no cursor, erase, hyperlink, title or redraw codes in a pipe',
    };
}

export async function pipeEscapes(
    command: string,
    args: readonly string[],
    ctx: Context,
    /** True when the args hold {fixture}: its file names are control-chars' to judge, not ours. */
    fixture = false
): Promise<PipeEscapesResult> {
    const raw = await run(command, args, { timeout: probeTimeout(ctx, command, args), env: ENV });
    if (raw.timedOut) markLongRunning(ctx, command, args);
    const r = fixture
        ? {
              ...raw,
              stdout: Buffer.from(withoutHostileNames(raw.stdout.toString('utf8'))),
              stderr: withoutHostileNames(raw.stderr),
          }
        : raw;
    return {
        check: 'pipe-escapes',
        invocation: [command, ...args],
        ...judgePipeEscapes(r),
        stdoutKinds: kindsOf(findControls(r.stdout.toString('utf8'))),
        stderrKinds: kindsOf(findControls(r.stderr)),
    };
}

export const pipeEscapesCheck: Check = {
    name: 'pipe-escapes',
    kind: 'check',
    summary: 'prints spinners, cursor codes, hyperlinks or titles into a pipe',
    async run(target, ctx) {
        const results: Result[] = [];
        for (const args of target.invocations) {
            results.push(
                await pipeEscapes(target.command, args, ctx, target.fixtureDir !== undefined)
            );
        }
        return results;
    },
};
