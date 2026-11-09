import { defineConfig, type ViteUserConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        // The tests run the built CLI as a black box, so build it once first.
        globalSetup: ['test/helpers/build.ts'],
        testTimeout: 30_000,
    },
});

export default config;
