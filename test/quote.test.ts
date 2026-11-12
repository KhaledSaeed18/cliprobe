import { describe, expect, it } from 'vitest';
import { shellJoin } from '../src/core/quote.ts';

describe('shellJoin', () => {
    it.each([
        [['ls', '-la', './src'], 'ls -la ./src'],
        [['ls', '{fixture}'], 'ls {fixture}'],
        [['node', '--dir={fixture}/a'], 'node --dir={fixture}/a'],
        [
            ['python3', '-c', 'import time; time.sleep(30)'],
            "python3 -c 'import time; time.sleep(30)'",
        ],
        [['printf', 'hi\\n'], "printf 'hi\\n'"],
        [['echo', "it's"], "echo 'it'\\''s'"],
        [['echo', ''], "echo ''"],
        [['echo', '$HOME', '*'], "echo '$HOME' '*'"],
    ])('%j -> %s', (args, shown) => {
        expect(shellJoin(args)).toBe(shown);
    });
});
