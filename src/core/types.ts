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
