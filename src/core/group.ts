import { execFile, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/** A process still running in a process group. */
export interface GroupMember {
    pid: number;
    /** Its command line, or its name when the command line can't be read. */
    command: string;
}

/** One running process, as a snapshot of the process table shows it. */
export interface ProcessInfo extends GroupMember {
    ppid: number;
    pgid: number;
    /**
     * When it started, so a PID the system reused for another process is not
     * mistaken for it: clock ticks since boot on Linux, the start time on macOS.
     */
    start: string;
}

/**
 * The processes of group `pgid` that are still running. Zombies are left out:
 * where nothing reaps orphans, as in a container without an init process, they
 * stay in the group for good although they have exited.
 */
export function groupMembers(pgid: number): GroupMember[] {
    return process.platform === 'linux' ? membersFromProc(pgid) : membersFromPs(pgid);
}

/** Linux: reads `<root>/<pid>/stat` and `cmdline` for every process. */
export function membersFromProc(pgid: number, root = '/proc'): GroupMember[] {
    return tableFromProc(root, (stat) => stat.pgid === pgid).map(({ pid, command }) => ({
        pid,
        command,
    }));
}

/** macOS and other systems without /proc: asks ps. */
export function membersFromPs(pgid: number): GroupMember[] {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,pgid=,stat=,args='], { encoding: 'utf8' });
    return parsePs(out, pgid);
}

const isGone = (state: string): boolean => state.startsWith('Z') || state.startsWith('X');

export interface ProcStat {
    name: string;
    state: string;
    ppid: number;
    pgid: number;
    /** Field 22, the start time in clock ticks since boot. */
    start: string;
}

/** Fields of a /proc/<pid>/stat line; the name may hold spaces and parentheses. */
export function parseProcStat(line: string): ProcStat {
    const open = line.indexOf('(');
    const close = line.lastIndexOf(')');
    // After the name: state (field 3), ppid (4), pgrp (5), ... starttime (22).
    const fields = line
        .slice(close + 1)
        .trim()
        .split(' ');
    return {
        name: line.slice(open + 1, close),
        state: fields[0] ?? '',
        ppid: Number(fields[1] ?? ''),
        pgid: Number(fields[2] ?? ''),
        start: fields[19] ?? '',
    };
}

/** Running members of group `pgid` from `ps -A -o pid=,pgid=,stat=,args=` output. */
export function parsePs(out: string, pgid: number): GroupMember[] {
    const members: GroupMember[] = [];
    for (const line of out.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!m || Number(m[2]) !== pgid || isGone(m[3] ?? '')) continue;
        members.push({ pid: Number(m[1]), command: (m[4] ?? '').trim() });
    }
    return members.sort((a, b) => a.pid - b.pid);
}

/** Every running process, without zombies, read from `<root>`. */
export function tableFromProc(
    root = '/proc',
    keep: (stat: ProcStat) => boolean = () => true
): ProcessInfo[] {
    const table: ProcessInfo[] = [];
    for (const entry of readdirSync(root)) {
        if (!/^\d+$/.test(entry)) continue;
        try {
            const stat = parseProcStat(readFileSync(`${root}/${entry}/stat`, 'utf8'));
            if (isGone(stat.state) || !keep(stat)) continue;
            const cmdline = readFileSync(`${root}/${entry}/cmdline`, 'utf8')
                .split('\0')
                .filter(Boolean)
                .join(' ');
            table.push({
                pid: Number(entry),
                ppid: stat.ppid,
                pgid: stat.pgid,
                start: stat.start,
                command: cmdline || stat.name,
            });
        } catch {
            // Exited while we looked.
        }
    }
    return table.sort((a, b) => a.pid - b.pid);
}

/** lstart is the only start time macOS ps gives; LC_ALL=C keeps its format fixed. */
const PS_ARGS = ['-A', '-o', 'pid=,ppid=,pgid=,lstart=,stat=,args='];
const PS_ENV = { ...process.env, LC_ALL: 'C' };
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(\S+)\s+(.*)$/;

/** Running processes from `ps -A -o pid=,ppid=,pgid=,lstart=,stat=,args=` output. */
export function parsePsTable(out: string): ProcessInfo[] {
    const table: ProcessInfo[] = [];
    for (const line of out.split('\n')) {
        const m = PS_LINE.exec(line);
        if (!m || isGone(m[5] ?? '')) continue;
        table.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            pgid: Number(m[3]),
            start: m[4] ?? '',
            command: (m[6] ?? '').trim(),
        });
    }
    return table.sort((a, b) => a.pid - b.pid);
}

/** A snapshot of every running process, read at once. */
export function processTable(): ProcessInfo[] {
    if (process.platform === 'linux') return tableFromProc();
    try {
        return parsePsTable(execFileSync('ps', PS_ARGS, { encoding: 'utf8', env: PS_ENV }));
    } catch {
        return [];
    }
}

/** processTable() without blocking: on macOS, ps takes a few milliseconds. */
export function processTableAsync(): Promise<ProcessInfo[]> {
    if (process.platform === 'linux') return Promise.resolve(tableFromProc());
    return new Promise((resolve) => {
        execFile('ps', PS_ARGS, { encoding: 'utf8', env: PS_ENV }, (error, out) => {
            resolve(error ? [] : parsePsTable(out));
        });
    });
}

/**
 * What one run started, followed by parent PID as well as by process group: a
 * child in its own group or session (Node's `detached`, setsid, daemons) leaves
 * the program's group, and once the program exits it is reparented, so only a
 * snapshot taken while the program runs links it to the program.
 */
export class ProcessTree {
    #root: number | undefined;
    readonly #groups: () => readonly number[];
    /** Descendants seen so far, by PID, with their start time. */
    readonly #seen = new Map<number, string>();

    /**
     * @param root the program's PID
     * @param groups the process groups whose members belong to the run, read
     * each time: the program's own, and the one under a pseudo-terminal
     */
    constructor(root: number, groups: () => readonly number[]) {
        this.#root = root;
        this.#groups = groups;
    }

    /** Once the program has exited and been reaped, its PID may belong to another process. */
    programExited(): void {
        this.#root = undefined;
    }

    /** Records the program's descendants from a snapshot taken while it runs. */
    record(table: readonly ProcessInfo[]): void {
        for (const p of this.running(table)) this.#seen.set(p.pid, p.start);
    }

    /**
     * The run's processes in `table`: the program, the members of its groups,
     * the descendants recorded earlier (the same PID and start time), and
     * everything below any of them. cliprobe itself is never one of them.
     */
    running(table: readonly ProcessInfo[]): ProcessInfo[] {
        const groups = new Set(this.#groups());
        const found = new Map<number, ProcessInfo>();
        // Never init, which adopts orphans, nor cliprobe: everything would be below them.
        const candidates = table.filter((p) => p.pid !== 1 && p.pid !== process.pid);
        for (const p of candidates) {
            if (
                p.pid === this.#root ||
                groups.has(p.pgid) ||
                (this.#seen.has(p.pid) && this.#seen.get(p.pid) === p.start)
            ) {
                found.set(p.pid, p);
            }
        }
        let grew = true;
        while (grew) {
            grew = false;
            for (const p of candidates) {
                if (!found.has(p.pid) && found.has(p.ppid)) {
                    found.set(p.pid, p);
                    grew = true;
                }
            }
        }
        return [...found.values()].sort((a, b) => a.pid - b.pid);
    }
}

/**
 * SIGKILLs the given processes, the run's groups, and every group that one of
 * the processes leads, so what they started after the snapshot goes too.
 */
export function killAll(processes: readonly ProcessInfo[], groups: readonly number[]): void {
    const targets = new Set<number>(groups.map((g) => -g));
    for (const p of processes) {
        targets.add(p.pid);
        if (p.pgid === p.pid) targets.add(-p.pid);
    }
    targets.delete(-process.pid);
    targets.delete(process.pid);
    targets.delete(-1);
    targets.delete(1);
    targets.delete(0);
    for (const target of targets) {
        try {
            process.kill(target, 'SIGKILL');
        } catch {
            // Already gone.
        }
    }
}
