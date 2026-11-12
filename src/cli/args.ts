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
    command: string | undefined;
    args: string[];
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
        command: undefined,
        args: [],
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] ?? '';
        if (a === '--') {
            [opts.command, ...opts.args] = argv.slice(i + 1);
            break;
        }
        if (a === '--json') opts.format = 'json';
        else if (a === '--bare') opts.bare = true;
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
            if (!Number.isInteger(opts.timeout) || opts.timeout <= 0) {
                throw new UsageError(
                    `--timeout needs a positive whole number of milliseconds, got "${String(value)}"`
                );
            }
        } else if (a === '--check' || a.startsWith('--check=')) {
            const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
            const names = (value ?? '')
                .split(',')
                .map((n) => n.trim())
                .filter(Boolean);
            if (names.length === 0) throw new UsageError('--check needs a check name');
            opts.checks.push(...names);
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
    return opts;
}
