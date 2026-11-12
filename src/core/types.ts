/** `info` is the only verdict of an info check: a measurement or observation, never a failure. */
export type Verdict = 'pass' | 'fail' | 'warn' | 'skip' | 'error' | 'info';

/** One check's outcome for one invocation, with the evidence that led to it. */
export interface Result {
    check: string;
    invocation: string[];
    verdict: Verdict;
    reason: string;
    evidence?: string;
}

/** A verdict and its explanation, before it is attached to an invocation. */
export interface Judgement {
    verdict: Verdict;
    reason: string;
    evidence?: string;
}

/** The program under test and the invocations to probe it with. */
export interface Target {
    command: string;
    /** Arguments for each probe, with {fixture} already replaced by `fixtureDir`. */
    invocations: string[][];
    /** True when the user gave the probe arguments; false for the default --version and --help. */
    explicit: boolean;
    /** The directory of hostile file names, when the arguments asked for one. */
    fixtureDir?: string;
}

export interface Context {
    /** Kill a single probe run after this many milliseconds. */
    timeout: number;
    /** Probes that a check saw still running at the timeout; see core/long-running.ts. */
    longRunning?: Set<string>;
}

export interface Check {
    /** Stable identifier used by --check and in JSON output. */
    name: string;
    /** "check" can fail; "info" only reports and never fails. */
    kind: 'check' | 'info';
    /** One line for --help. */
    summary: string;
    run(target: Target, ctx: Context): Promise<Result[]>;
}
