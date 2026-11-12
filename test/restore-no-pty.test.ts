import { describe, expect, it, vi } from 'vitest';
import { restoreCheck } from '../src/checks/restore.ts';
import type * as Pty from '../src/core/pty.ts';

vi.mock('../src/core/pty.ts', async (original) => ({
    ...(await original<typeof Pty>()),
    ptySupport: () => ({ ok: false, reason: 'script(1) not found' }),
}));

describe('restore without a PTY', () => {
    it('skips each invocation and says why', async () => {
        const target = { command: 'sh', invocations: [['--version'], ['--help']], explicit: false };
        const results = await restoreCheck.run(target, { timeout: 1000 });
        expect(results.map((r) => [r.verdict, r.reason])).toEqual([
            ['skip', 'needs a terminal (script(1) not found)'],
            ['skip', 'needs a terminal (script(1) not found)'],
        ]);
    });
});
