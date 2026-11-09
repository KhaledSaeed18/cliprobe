import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
    entry: { cli: 'src/cli/main.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22.12',
    dts: false,
    sourcemap: false,
    clean: true,
    treeshake: true,
    publint: false,
    fixedExtension: false,
});

export default config;
