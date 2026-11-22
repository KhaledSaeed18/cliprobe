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

/** Every option cliprobe takes, to tell a forgotten value from a value that starts with -. */
const OPTIONS: ReadonlySet<string> = new Set([
    '--json',
    '--bare',
    '--strict',
    '-o',
    '--output-file',
    '--format',
    '-h',
    '--help',
    '-v',
    '--version',
    '--timeout',
    '--probe',
    '--check',
    '--skip',
]);
/** Options whose value is a path, which ./ can make start with something other than -. */
const PATH_OPTIONS: ReadonlySet<string> = new Set(['-o', '--output-file']);

/** The option name in an argument such as --format=json. */
const flagOf = (arg: string): string => arg.split('=')[0] ?? arg;

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
        /** The value of the option `a`: after its `=`, or the next argument, which must not be another option. */
        const value = (what: string): string => {
            const flag = flagOf(a);
            const inline = a.includes('=');
            const v = inline ? a.slice(a.indexOf('=') + 1) : argv[++i];
            if (v === undefined || v === '') throw new UsageError(`${flag} needs ${what}`);
            if (!inline && v.startsWith('-')) {
                // A forgotten value would silently swallow the next option (-o --strict).
                const hint =
                    PATH_OPTIONS.has(flag) && !OPTIONS.has(flagOf(v))
                        ? `; use ${flag}=${v} or ./${v} for a value that starts with -`
                        : '';
                throw new UsageError(`${flag} needs ${what}, got option "${v}"${hint}`);
            }
            return v;
        };
        if (a === '--json') opts.format = 'json';
        else if (a === '--bare') opts.bare = true;
        else if (a === '--strict') opts.strict = true;
        else if (/^(-o|--output-file)(=|$)/.test(a)) opts.outputFile = value('a file path');
        else if (/^--format(=|$)/.test(a)) {
            const format = value(`a value (one of ${FORMAT_NAMES.join(', ')})`);
            if (!isFormat(format)) {
                throw new UsageError(
                    `--format needs one of ${FORMAT_NAMES.join(', ')}, got "${format}"`
                );
            }
            opts.format = format;
        } else if (a === '-h' || a === '--help') opts.help = true;
        else if (a === '-v' || a === '--version') opts.version = true;
        else if (/^--timeout(=|$)/.test(a)) {
            const ms = value('a value');
            opts.timeout = Number(ms);
            // Number() keeps forms such as 1e3 working; the cap is what setTimeout takes.
            if (
                !Number.isInteger(opts.timeout) ||
                opts.timeout <= 0 ||
                opts.timeout > MAX_TIMEOUT_MS
            ) {
                throw new UsageError(
                    `--timeout needs a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS} (about 24 days), got "${ms}"`
                );
            }
        } else if (a === '--probe' || a.startsWith('--probe=')) {
            // Not value(): a probe may well start with -, such as --probe "--json".
            const probe = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
            if (probe === undefined) throw new UsageError('--probe needs the arguments to probe');
            let words: string[];
            try {
                words = shellSplit(probe);
            } catch (error) {
                throw new UsageError(
                    `--probe ${shellJoin([probe])} ${error instanceof Error ? error.message : String(error)}`
                );
            }
            if (words.length === 0) {
                throw new UsageError('--probe needs the arguments to probe; use --bare for none');
            }
            opts.probes.push(words);
        } else if (/^--(check|skip)(=|$)/.test(a)) {
            const flag = flagOf(a);
            const names = value('a check name')
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
