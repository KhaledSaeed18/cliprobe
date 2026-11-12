import { defineConfig, type ViteUserConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        // The tests run the built CLI as a black box, so build it once first.
        globalSetup: ['test/helpers/build.ts'],
        testTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Only wires the real process into run(); the black-box suite covers it.
            exclude: ['src/cli/main.ts'],
            reporter: ['text', 'lcov'],
            // A ratchet just under what macOS and Linux both reach today (the
            // PTY flavor detection covers a different branch on each); raise it
            // as coverage grows, never lower it.
            thresholds: { statements: 94, branches: 85, functions: 100, lines: 95 },
        },
    },
});

export default config;
