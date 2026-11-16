import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeSigterm } from '../src/checks/sigterm.ts';
import {
    groupMembers,
    membersFromProc,
    membersFromPs,
    parseProcStat,
    parsePs,
} from '../src/core/group.ts';
import type { RunResult } from '../src/core/run.ts';
import { cliprobe, first, fixture, probeJson, runCheck } from './helpers/cli.ts';

const node = process.execPath;
const only = { checks: ['sigterm'] };

interface SigtermJson {
    verdict: string;
    reason: string;
    evidence?: string;
    sentAfterMs: number | null;
    exitedAfterMs: number | null;
    exitCode: number | null;
    signal: string | null;
    leftRunning: string[];
}

async function probe(
    command: readonly string[]
): Promise<{ status: number | null; result: SigtermJson }> {
    const { status, report } = await probeJson(command, only);
    return { status, result: first(report) as unknown as SigtermJson };
}

const termFixture = (name: string): string[] => [node, fixture(`sigterm/${name}`)];

describe('sigterm: fixtures', () => {
    it.each([
        ['default', 'pass', /stopped by SIGTERM in \d+ ms and left nothing running/],
        ['graceful', 'pass', /exited with code 0/],
        ['forwards', 'pass', /exited with code 0 .*left nothing running/],
        ['ignores', 'warn', /ignored SIGTERM: still running 3 s later/],
        ['orphans', 'warn', /left 1 process running/],
        ['orphans-quiet', 'warn', /left 2 processes running/],
        ['throws', 'warn', /stack trace on SIGTERM/],
        ['quick', 'skip', /finished in \d+ ms, before SIGTERM/],
    ])('%s -> %s', async (name, verdict, reason) => {
        const { result } = await probe(termFixture(name));
        expect(result.verdict).toBe(verdict);
        expect(result.reason).toMatch(reason);
    });

    it('names what it left running', async () => {
        const { result } = await probe(termFixture('orphans-quiet'));
        expect(result.leftRunning).toHaveLength(2);
        // Time to its own exit, without the wait for its children.
        expect(result.exitedAfterMs).toBeLessThan(500);
        expect(result.evidence).toMatch(/^still running: .*sigterm-orphan \(and 1 more\)$/);
    });

    it('kills what the program left running', async () => {
        // Only the fixtures' children, not shells that mention the marker.
        const running = (): string[] =>
            execFileSync('ps', ['-axo', 'args='], { encoding: 'utf8' })
                .split('\n')
                .filter((line) => line.startsWith(node) && line.endsWith('sigterm-orphan'));
        await probe(termFixture('orphans'));
        await probe(termFixture('orphans-quiet'));
        expect(running()).toEqual([]);
    });

    it('quotes the error and the frame in the program as evidence', async () => {
        expect((await probe(termFixture('throws'))).result.evidence).toMatch(
            /^Error: terminated \(at .*throws\.mjs:\d+:\d+\)$/
        );
    });

    it('records when SIGTERM was sent and how long the exit took', async () => {
        const { result } = await probe(termFixture('graceful'));
        expect(result.sentAfterMs).toBeGreaterThanOrEqual(1000);
        expect(result.exitedAfterMs).toBeGreaterThanOrEqual(150);
        expect(result.exitedAfterMs).toBeLessThan(3000);
        expect(result.exitCode).toBe(0);
    });

    it('only warns, so the exit code stays 0', async () => {
        expect((await probe(termFixture('ignores'))).status).toBe(0);
    });

    it('reports a missing command as could-not-run', async () => {
        const [result] = await runCheck('sigterm', ['cliprobe-no-such-command-xyz', 'watch']);
        expect(result?.verdict).toBe('error');
    });

    it('skips once, without running anything, when there are no probe args', async () => {
        const { report } = await probeJson([node], only);
        expect(report.results).toHaveLength(1);
        expect(first(report)).toMatchObject({ verdict: 'skip', invocation: [node] });
        expect(first(report).reason).toMatch(/keep it running/);
    });

    it('shows the reason in human output', async () => {
        const r = await cliprobe(['--check', 'sigterm', '--', ...termFixture('orphans')]);
        expect(r.stdout).toMatch(/WARN .*left 1 process running/);
    });
});

describe('sigterm: real tools', () => {
    it.each([
        ['sleep', ['sleep', '30']],
        ['tail -f', ['tail', '-f', '/dev/null']],
        ['a shell that execs its command', ['sh', '-c', 'exec sleep 30']],
        ['node with a timer', [node, '-e', 'setInterval(() => {}, 1000)']],
    ])('%s passes', async (_name, command) => {
        expect((await probe(command)).result.verdict).toBe('pass');
    });

    it('a shell that waits on its command leaves it running', async () => {
        const { result } = await probe(['sh', '-c', 'sleep 30; echo done']);
        expect(result.verdict).toBe('warn');
        expect(result.evidence).toBe('still running: sleep 30');
    });
});

describe('judgeSigterm', () => {
    const base: RunResult = {
        stdoutBytes: 0,
        stdout: Buffer.alloc(0),
        stderr: '',
        timedOut: false,
        exitCode: 0,
        signal: null,
        durationMs: 1500,
        signalSentMs: 1000,
        stderrAtSignal: 0,
    };

    it('reports what was left running before a stack trace', () => {
        const j = judgeSigterm({
            ...base,
            stderr: 'Error: x\n    at main (/app/cli.js:1:1)\n',
            leftRunning: [{ pid: 2, command: 'node server.js' }],
        });
        expect(j.reason).toMatch(/left 1 process running/);
        expect(j.evidence).toBe('still running: node server.js');
    });

    it('ignores a stack trace printed before SIGTERM', () => {
        const stderr = 'Warning\n    at main (/app/cli.js:1:1)\n';
        const j = judgeSigterm({ ...base, stderr, stderrAtSignal: stderr.length });
        expect(j.verdict).toBe('pass');
    });
});

describe('group members', () => {
    it('parses /proc stat lines, whose name may hold spaces and parentheses', () => {
        expect(parseProcStat('42 (my (odd) name) S 1 42 42 0 -1')).toEqual({
            name: 'my (odd) name',
            state: 'S',
            pgid: 42,
        });
    });

    it('keeps the running members of one group from ps output, without zombies', () => {
        const out = [
            '  10    10 Ss   node server.js',
            '  11    10 S+   node child.js --port 3000',
            '  12    10 Z    (node)',
            '  13    99 S    other',
            '',
        ].join('\n');
        expect(parsePs(out, 10)).toEqual([
            { pid: 10, command: 'node server.js' },
            { pid: 11, command: 'node child.js --port 3000' },
        ]);
    });

    it('finds nothing in a group that does not exist', () => {
        expect(groupMembers(2 ** 22 + 12345)).toEqual([]);
    });

    it('reads a /proc tree, skipping zombies, other groups and processes that vanish', () => {
        const root = mkdtempSync(join(tmpdir(), 'cliprobe-proc-'));
        const proc = (pid: number, stat: string, cmdline?: string): void => {
            mkdirSync(join(root, String(pid)));
            writeFileSync(join(root, String(pid), 'stat'), stat);
            if (cmdline !== undefined) writeFileSync(join(root, String(pid), 'cmdline'), cmdline);
        };
        try {
            proc(101, '101 (node) S 1 50 50 0', 'node\0child.js\0');
            proc(100, '100 (sh) S 1 50 50 0', '');
            proc(102, '102 (node) Z 1 50 50 0', '');
            proc(103, '103 (vim) S 1 60 60 0', 'vim\0');
            proc(104, '104 (gone) S 1 50 50 0'); // exited before its cmdline was read
            mkdirSync(join(root, 'self'));
            expect(membersFromProc(50, root)).toEqual([
                { pid: 100, command: 'sh' },
                { pid: 101, command: 'node child.js' },
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('asks ps for the members of a real group', async () => {
        const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
        try {
            await new Promise((resolve) => child.once('spawn', resolve));
            expect(membersFromPs(child.pid ?? 0)).toEqual([
                { pid: child.pid, command: 'sleep 30' },
            ]);
        } finally {
            child.kill('SIGKILL');
        }
    });
});
