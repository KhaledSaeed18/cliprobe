import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/** A process still running in a process group. */
export interface GroupMember {
    pid: number;
    /** Its command line, or its name when the command line can't be read. */
    command: string;
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
    const members: GroupMember[] = [];
    for (const entry of readdirSync(root)) {
        if (!/^\d+$/.test(entry)) continue;
        try {
            const stat = parseProcStat(readFileSync(`${root}/${entry}/stat`, 'utf8'));
            if (stat.pgid !== pgid || isGone(stat.state)) continue;
            const cmdline = readFileSync(`${root}/${entry}/cmdline`, 'utf8')
                .split('\0')
                .filter(Boolean)
                .join(' ');
            members.push({ pid: Number(entry), command: cmdline || stat.name });
        } catch {
            // Exited while we looked.
        }
    }
    return members.sort((a, b) => a.pid - b.pid);
}

/** macOS and other systems without /proc: asks ps. */
export function membersFromPs(pgid: number): GroupMember[] {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,pgid=,stat=,args='], { encoding: 'utf8' });
    return parsePs(out, pgid);
}

const isGone = (state: string): boolean => state.startsWith('Z') || state.startsWith('X');

/** Name, state and group from a /proc/<pid>/stat line; the name may hold spaces and parentheses. */
export function parseProcStat(line: string): { name: string; state: string; pgid: number } {
    const open = line.indexOf('(');
    const close = line.lastIndexOf(')');
    const [state = '', , pgid = ''] = line
        .slice(close + 1)
        .trim()
        .split(' ');
    return { name: line.slice(open + 1, close), state, pgid: Number(pgid) };
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
