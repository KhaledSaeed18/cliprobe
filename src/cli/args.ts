export class UsageError extends Error {}

export interface Options {
    json: boolean;
    timeout: number;
    help: boolean;
    version: boolean;
    /** Check names from --check, in the order given; empty means all. */
    checks: string[];
    command: string | undefined;
    args: string[];
}

export function parseArgs(argv: readonly string[]): Options {
    const opts: Options = {
        json: false,
        timeout: 15000,
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
        if (a === '--json') opts.json = true;
        else if (a === '-h' || a === '--help') opts.help = true;
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
    return opts;
}
