import { describe, expect, it } from 'vitest';
import { UNKNOWN_FLAG } from '../src/checks/baseline.ts';
import { parseArgs } from '../src/cli/args.ts';
import { shellJoin, shellSplit } from '../src/core/quote.ts';
import { cliprobe, fixture, probeJson } from './helpers/cli.ts';

const node = process.execPath;
const ESC = String.fromCharCode(0x1b);
/** A --probe string that runs this fixture under `node`. */
const script = (name: string, ...args: string[]): string => shellJoin([fixture(name), ...args]);
const shown = (invocation: readonly string[]): string => invocation.slice(1).join(' ');

describe('shellSplit', () => {
    it.each([
        ['watch app.ts', ['watch', 'app.ts']],
        ['  serve\t--port  0 \n', ['serve', '--port', '0']],
        ["-e 'setTimeout(() => {}, 1e5)'", ['-e', 'setTimeout(() => {}, 1e5)']],
        ['say "a \\"quoted\\" \\\\ $x"', ['say', 'a "quoted" \\ $x']],
        ['say "a\\b"', ['say', 'a\\b']],
        ['one\\ word two', ['one word', 'two']],
        ['glued\'single\'"double"', ['gluedsingledouble']],
        ['\'\' ""', ['', '']],
        ['$HOME *.js ~', ['$HOME', '*.js', '~']],
        ['ls {fixture}', ['ls', '{fixture}']],
        ['a \\\nb', ['a', 'b']],
        ['"a\\\nb"', ['ab']],
        ['', []],
    ])('%j', (text, words) => {
        expect(shellSplit(text)).toEqual(words);
    });

    it('reads back what shellJoin writes', () => {
        const args = ['python3', '-c', 'print(\'hi\'); x = "$y"', '', 'a b', '\\', '{fixture}'];
        expect(shellSplit(shellJoin(args))).toEqual(args);
    });

    it.each([
        ["it's", 'has an unclosed single quote'],
        ['say "hi', 'has an unclosed double quote'],
        ['oops\\', 'ends with a backslash'],
    ])('rejects %j', (text, message) => {
        expect(() => shellSplit(text)).toThrow(message);
    });
});

describe('parseArgs --probe', () => {
    it('collects each probe, split like a shell command line', () => {
        const opts = parseArgs(['--probe', 'watch app.ts', '--probe=ls {fixture}', '--', 'tsx']);
        expect(opts.probes).toEqual([
            ['watch', 'app.ts'],
            ['ls', '{fixture}'],
        ]);
        expect(opts.args).toEqual([]);
    });

    it('works with --bare, which adds the empty probe', () => {
        expect(parseArgs(['--bare', '--probe', 'serve', '--', 'tool']).probes).toEqual([['serve']]);
    });

    it.each([
        [['--probe'], '--probe needs the arguments to probe'],
        [['--probe', '  '], '--probe needs the arguments to probe; use --bare for none'],
        [['--probe', "it's"], `--probe 'it'\\''s' has an unclosed single quote`],
        [['--probe', '--help', '--', 'tool'], '--probe --help repeats a probe that already runs'],
        [['--probe', 'a b', '--probe', "a 'b'", '--', 'tool'], 'repeats a probe'],
        [['--probe', 'serve', '--', 'tool', 'serve'], 'repeats a probe'],
    ])('rejects %j', (argv, message) => {
        expect(() => parseArgs(argv)).toThrow(message);
    });

    it('allows --version as a probe when args after the command replace the defaults', () => {
        expect(parseArgs(['--probe', '--version', '--', 'tool', 'serve']).probes).toEqual([
            ['--version'],
        ]);
    });
});

describe('--probe', () => {
    it('adds probes after the defaults, and only those reach ctrl-c and sigterm', async () => {
        const { status, report } = await probeJson([node], {
            checks: ['stdin', 'ctrl-c', 'sigterm'],
            probes: [script('ctrl-c/default')],
        });
        expect(status).toBe(0);
        const byCheck = (check: string): string[][] =>
            report.results
                .filter((r) => r.check === check)
                .map((r) => [shown(r.invocation), r.verdict]);
        const probe = fixture('ctrl-c/default');
        expect(byCheck('stdin')).toEqual([
            ['--version', 'pass'],
            ['--help', 'pass'],
            [probe, expect.not.stringMatching(/fail|error/) as unknown as string],
        ]);
        expect(byCheck('ctrl-c')).toEqual([[probe, 'pass']]);
        expect(byCheck('sigterm')).toEqual([[probe, 'pass']]);
    });

    it('runs control-chars only on the probes with {fixture}, and reports the placeholder', async () => {
        const { status, report } = await probeJson([node, fixture('control-chars/escaped')], {
            checks: ['control-chars', 'closed-pipe'],
            probes: [script('control-chars/raw', '{fixture}')],
        });
        expect(status).toBe(1);
        const results = report.results.map((r) => [r.check, shown(r.invocation), r.verdict]);
        // Registry order: closed-pipe runs every probe, control-chars only the one with {fixture}.
        expect(results).toEqual([
            ['closed-pipe', fixture('control-chars/escaped'), expect.any(String)],
            ['closed-pipe', `${fixture('control-chars/raw')} {fixture}`, expect.any(String)],
            ['control-chars', `${fixture('control-chars/raw')} {fixture}`, 'fail'],
        ]);
    });

    it('keeps startup and baseline on the main probe', async () => {
        const { report } = await probeJson([node, fixture('ctrl-c/quick')], {
            checks: ['startup', 'baseline'],
            probes: ['-e 0'],
        });
        const quick = fixture('ctrl-c/quick');
        expect(report.results.map((r) => shown(r.invocation))).toEqual([
            quick,
            `${quick} --version`,
            `${quick} --help`,
            `${quick} ${UNKNOWN_FLAG}`,
        ]);
        const defaults = await probeJson([node], { checks: ['startup'], probes: ['-e 0'] });
        expect(defaults.report.results.map((r) => shown(r.invocation))).toEqual(['--version']);
    });

    it('types Ctrl-C under the terminal only for probes the user named', async () => {
        const { report } = await probeJson([node], {
            checks: ['restore'],
            probes: [script('ctrl-c/default')],
        });
        const interrupted = report.results.map((r) => r.details['interrupted']);
        if (report.results.every((r) => r.verdict === 'skip')) return; // no terminal here
        expect(interrupted).toEqual([false, false, true]);
    });

    it('prints a bad --probe escaped, as a usage error', async () => {
        const r = await cliprobe(['--probe', `"${ESC}[2J`, '--', 'true']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain(`--probe '"\\x1b[2J' has an unclosed double quote`);
        expect(r.stderr).not.toContain(ESC);
    });
});
