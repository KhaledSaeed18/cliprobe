export type Verdict = 'pass' | 'fail' | 'warn' | 'skip' | 'error';

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
    invocations: string[][];
}

export interface Context {
    /** Kill a single probe run after this many milliseconds. */
    timeout: number;
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
