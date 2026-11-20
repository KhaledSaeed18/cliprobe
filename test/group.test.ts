import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    killAll,
    parsePsTable,
    type ProcessInfo,
    processTable,
    processTableAsync,
    ProcessTree,
    tableFromProc,
} from '../src/core/group.ts';

const proc = (pid: number, ppid: number, pgid: number, start = `t${pid}`): ProcessInfo => ({
    pid,
    ppid,
    pgid,
    start,
    command: `p${pid}`,
});

const pids = (list: readonly ProcessInfo[]): number[] => list.map((p) => p.pid);

describe('the process table', () => {
    it('parses ps output with parent, group and start time, without zombies', () => {
        const out = [
            '  10     1    10 Fri Nov 20 10:00:00 2026     Ss   node server.js',
            '  11    10    10 Fri Nov  2 10:00:01 2026     S+   node child.js --port 3000',
            '  12    10    10 Fri Nov 20 10:00:01 2026     Z    (node)',
            'garbage',
            '',
        ].join('\n');
        expect(parsePsTable(out)).toEqual([
            {
                pid: 10,
                ppid: 1,
                pgid: 10,
                start: 'Fri Nov 20 10:00:00 2026',
                command: 'node server.js',
            },
            {
                pid: 11,
                ppid: 10,
                pgid: 10,
                start: 'Fri Nov  2 10:00:01 2026',
                command: 'node child.js --port 3000',
            },
        ]);
    });

    it('reads parent, group and start time from a /proc tree', () => {
        const root = mkdtempSync(join(tmpdir(), 'cliprobe-proc-'));
        const entry = (pid: number, stat: string, cmdline: string): void => {
            mkdirSync(join(root, String(pid)));
            writeFileSync(join(root, String(pid), 'stat'), stat);
            writeFileSync(join(root, String(pid), 'cmdline'), cmdline);
        };
        // Fields 7 to 21, between the session and the start time.
        const rest = '0 -1 0 0 0 0 0 0 0 0 0 0 0 0 0';
        try {
            entry(7, `7 (my (odd) name) S 3 5 5 ${rest} 4242 1`, 'a\0b\0');
            entry(8, `8 (z) Z 3 5 5 ${rest} 4243 1`, '');
            expect(tableFromProc(root)).toEqual([
                { pid: 7, ppid: 3, pgid: 5, start: '4242', command: 'a b' },
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('sees a real child with its parent and group, at once and without blocking', async () => {
        const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
        try {
            await new Promise((resolve) => child.once('spawn', resolve));
            for (const table of [processTable(), await processTableAsync()]) {
                const found = table.find((p) => p.pid === child.pid);
                expect(found).toMatchObject({
                    ppid: process.pid,
                    pgid: child.pid,
                    command: 'sleep 30',
                });
                expect(found?.start).not.toBe('');
            }
        } finally {
            child.kill('SIGKILL');
        }
    });
});

describe('ProcessTree', () => {
    it('finds the program, its group and everything below them', () => {
        const tree = new ProcessTree(10, () => [10]);
        const table = [
            proc(10, 1, 10),
            proc(11, 10, 10),
            proc(12, 11, 12), // a child in its own group
            proc(13, 12, 12), // below it
            proc(20, 1, 20), // unrelated
        ];
        expect(pids(tree.running(table))).toEqual([10, 11, 12, 13]);
    });

    it('remembers descendants after the program exits and they are reparented', () => {
        const tree = new ProcessTree(10, () => [10]);
        tree.record([proc(10, 1, 10), proc(12, 10, 12), proc(13, 12, 13)]);
        tree.programExited();
        // Program gone, its children reparented to init, and PID 10 reused.
        const after = [
            proc(10, 1, 99, 'later'),
            proc(12, 1, 12),
            proc(13, 1, 13),
            proc(14, 13, 14),
        ];
        expect(pids(tree.running(after))).toEqual([12, 13, 14]);
    });

    it('never takes a reused PID for a descendant, nor init or cliprobe itself', () => {
        const tree = new ProcessTree(10, () => [10, 1]);
        tree.record([proc(10, 1, 10), proc(12, 10, 12, 'first')]);
        tree.programExited();
        const after = [proc(1, 0, 1), proc(12, 1, 12, 'second'), proc(process.pid, 1, 1)];
        expect(pids(tree.running(after))).toEqual([]);
    });

    it('counts the members of an extra group read when needed', () => {
        let extra: number[] = [];
        const tree = new ProcessTree(10, () => [10, ...extra]);
        const table = [proc(10, 1, 10), proc(30, 1, 30)];
        expect(pids(tree.running(table))).toEqual([10]);
        extra = [30];
        expect(pids(tree.running(table))).toEqual([10, 30]);
    });
});

describe('killAll', () => {
    it('kills each process and the groups they lead, and never cliprobe', async () => {
        const leader = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
        await new Promise((resolve) => leader.once('spawn', resolve));
        const gone = new Promise((resolve) => leader.once('exit', (_, signal) => resolve(signal)));
        const pid = leader.pid ?? 0;
        killAll([proc(pid, process.pid, pid), proc(process.pid, 1, process.pid)], [1, 0]);
        expect(await gone).toBe('SIGKILL');
    });

    it('ignores processes and groups that are already gone', () => {
        expect(() =>
            killAll([proc(2 ** 22 + 12345, 1, 2 ** 22 + 12345)], [2 ** 22 + 12346])
        ).not.toThrow();
    });
});
