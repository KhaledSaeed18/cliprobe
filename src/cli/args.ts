import { shellJoin, shellSplit } from '../core/quote.ts';
import { MAX_TIMEOUT_MS } from '../core/run.ts';
import { type Format, FORMAT_NAMES, isFormat } from '../report/index.ts';

export class UsageError extends Error {}

export interface Options {
    /** Output format; --json is shorthand for --format json. */
    format: Format;
    /** Write the --format report here; the human report still goes to stdout. */
    outputFile: string | undefined;
    timeout: number;
    /** Probe the command with no arguments, instead of --version and --help. */
    bare: boolean;
    help: boolean;
    version: boolean;
    /** Check names from --check, in the order given; empty means all. */
    checks: string[];
    /** Check names from --skip, left out of what --check selects. */
    skip: string[];
    /** Exit 1 on a warning too, not only on a failure. */
    strict: boolean;
    command: string | undefined;
    args: string[];
    /** Extra probes from --probe, each split into arguments like a shell command line. */
    probes: string[][];
}

export function parseArgs(argv: readonly string[]): Options {
    const opts: Options = {
        format: 'human',
        outputFile: undefined,
        timeout: 15000,
        bare: false,
        help: false,
        version: false,
        checks: [],
        skip: [],
        strict: false,
        command: undefined,
        args: [],
        probes: [],
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] ?? '';
        if (a === '--') {
            [opts.command, ...opts.args] = argv.slice(i + 1);
            break;
        }
        if (a === '--json') opts.format = 'json';
        else if (a === '--bare') opts.bare = true;
        else if (a === '--strict') opts.strict = true;
        else if (a === '-o' || a === '--output-file' || a.startsWith('--output-file=')) {
            const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
            if (!value) throw new UsageError(`${a.split('=')[0] ?? a} needs a file path`);
            opts.outputFile = value;
        } else if (a === '--format' || a.startsWith('--format=')) {
            const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
            if (value === undefined || !isFormat(value)) {
                throw new UsageError(
                    `--format needs one of ${FORMAT_NAMES.join(', ')}, got "${String(value)}"`
                );
            }
            opts.format = value;
        } else if (a === '-h' || a === '--help') opts.help = true;
        else if (a === '-v' || a === '--version') opts.version = true;
        else if (a === '--timeout' || a.startsWith('--timeout=')) {
            const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
            opts.timeout = Number(value);
            // Number() keeps forms such as 1e3 working; the cap is what setTimeout takes.
            if (
                !Number.isInteger(opts.timeout) ||
                opts.timeout <= 0 ||
                opts.timeout > MAX_TIMEOUT_MS
            ) {
                throw new UsageError(
                    `--timeout needs a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS} (about 24 days), got "${String(value)}"`
                );
            }
        } else if (a === '--probe' || a.startsWith('--probe=')) {
            const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
            if (value === undefined) throw new UsageError('--probe needs the arguments to probe');
            let words: string[];
            try {
                words = shellSplit(value);
            } catch (error) {
                throw new UsageError(
                    `--probe ${shellJoin([value])} ${error instanceof Error ? error.message : String(error)}`
                );
            }
            if (words.length === 0) {
                throw new UsageError('--probe needs the arguments to probe; use --bare for none');
            }
            opts.probes.push(words);
        } else if (/^--(check|skip)(=|$)/.test(a)) {
            const flag = a.split('=')[0] ?? a;
            const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
            const names = (value ?? '')
                .split(',')
                .map((n) => n.trim())
                .filter(Boolean);
            if (names.length === 0) throw new UsageError(`${flag} needs a check name`);
            (flag === '--skip' ? opts.skip : opts.checks).push(...names);
        } else if (a.startsWith('-')) throw new UsageError(`unknown option "${a}"`);
        else {
            // No "--": the first bare argument starts the command.
            [opts.command, ...opts.args] = argv.slice(i);
            break;
        }
    }
    if (opts.bare && opts.args.length) {
        throw new UsageError('--bare probes the command with no arguments, so give none after it');
    }
    const seen = new Set(mainProbe(opts).map((args) => JSON.stringify(args)));
    for (const args of opts.probes) {
        const key = JSON.stringify(args);
        if (seen.has(key)) {
            throw new UsageError(`--probe ${shellJoin(args)} repeats a probe that already runs`);
        }
        seen.add(key);
    }
    return opts;
}

/** The arguments given after the command, the empty --bare probe, or the default --version and --help. */
export function mainProbe(opts: Pick<Options, 'bare' | 'args'>): string[][] {
    if (opts.bare) return [[]];
    return opts.args.length ? [opts.args] : [['--version'], ['--help']];
}
