# Changelog

## [0.5.0](https://github.com/KhaledSaeed18/cliprobe/compare/v0.4.1...v0.5.0) (2026-11-12)

### Features

* add the restore check ([049bbd4](https://github.com/KhaledSaeed18/cliprobe/commit/049bbd49c26fe12c8adcd8168e2a0ce9fc2a7f17))
* **core:** find terminal modes that output leaves switched on ([b2ed60a](https://github.com/KhaledSaeed18/cliprobe/commit/b2ed60a726e20d759b71e86212dd8b0a10ab3dbc))
* **core:** look up a command on PATH ([beaf935](https://github.com/KhaledSaeed18/cliprobe/commit/beaf935220c2bf94c23eaabf31cd7ea4080f83ae))
* **core:** type input into the pseudo-terminal ([a2db9fd](https://github.com/KhaledSaeed18/cliprobe/commit/a2db9fdef8ec5513ab210c55e099529a6f146530))

## [0.4.1](https://github.com/KhaledSaeed18/cliprobe/compare/v0.4.0...v0.4.1) (2026-11-12)

## [0.4.0](https://github.com/KhaledSaeed18/cliprobe/compare/v0.3.0...v0.4.0) (2026-11-11)

### Features

* add the stdin check ([f1fa667](https://github.com/KhaledSaeed18/cliprobe/commit/f1fa667811826f1113cbba44981a6df68d580290))
* **core:** run a program with stdin as an open or closing pipe ([d4c0a8d](https://github.com/KhaledSaeed18/cliprobe/commit/d4c0a8dea8200157dd986d40a5310c0702fcaa80))

## [0.3.0](https://github.com/KhaledSaeed18/cliprobe/compare/v0.2.0...v0.3.0) (2026-11-11)

### Features

* add the pipe-escapes check ([e6fbf46](https://github.com/KhaledSaeed18/cliprobe/commit/e6fbf4602878e82374c2ada4994dccacb9c17e01))
* **core:** detect terminal control codes other than color ([dd34544](https://github.com/KhaledSaeed18/cliprobe/commit/dd345440cc89f2f1774999d222d684d8eff63a42))

### Bug Fixes

* **core:** name the package that provides script(1) on Alpine ([c07490d](https://github.com/KhaledSaeed18/cliprobe/commit/c07490ddefb78f12b7bc0c92d8b240b8fdd0cf4b))

## [0.2.0](https://github.com/KhaledSaeed18/cliprobe/compare/v0.1.0...v0.2.0) (2026-11-11)

### Features

* **cli:** choose the output format with --format ([35ae9e6](https://github.com/KhaledSaeed18/cliprobe/commit/35ae9e6b0f1d713a118c93572beec16902743728))
* **cli:** write the report to a file with --output-file ([1fd4a23](https://github.com/KhaledSaeed18/cliprobe/commit/1fd4a238acc7d636e93c2dece214926ce015cbd4))
* **report:** add a JUnit XML format for CI test reports ([e4d384c](https://github.com/KhaledSaeed18/cliprobe/commit/e4d384c6b4bf5a07b1260e92cf2e418d44cb7c53))
* **report:** add a Markdown format for CI summaries and PR comments ([263c564](https://github.com/KhaledSaeed18/cliprobe/commit/263c56425b7adbd4ed7d2872b90549bf30e36c44))

## [0.1.0](https://github.com/KhaledSaeed18/cliprobe/compare/v0.0.1...v0.1.0) (2026-11-11)

### Features

* add --check to run only the named checks ([71404d2](https://github.com/KhaledSaeed18/cliprobe/commit/71404d28847afcf4ac53497ba886f2c3035fe4a4))
* add a {fixture} placeholder for a directory of hostile file names ([a844791](https://github.com/KhaledSaeed18/cliprobe/commit/a84479155adc39ca9ed6592fa2e526af6183d65c))
* add info checks, starting with startup time ([eaca4fb](https://github.com/KhaledSaeed18/cliprobe/commit/eaca4fbd7d28e64e36ac79258fc101a7245db594))
* add the baseline info check ([99ad43c](https://github.com/KhaledSaeed18/cliprobe/commit/99ad43c3cdbade3e6d4d4f6b10744b898ac9b00a))
* add the color check ([b30bcdd](https://github.com/KhaledSaeed18/cliprobe/commit/b30bcdd5b02846c5810e53d3e44c4e7624fc5961))
* add the control-chars check ([5aec42f](https://github.com/KhaledSaeed18/cliprobe/commit/5aec42f268697bc7364f35c3f4dd1e5474f8693a))
* add the ctrl-c check ([ce972ee](https://github.com/KhaledSaeed18/cliprobe/commit/ce972ee0e35eba495742396e3b0227fe407b3602))
* **core:** add a PTY runner built on script(1) ([f85430d](https://github.com/KhaledSaeed18/cliprobe/commit/f85430d2f9f41d84d25b8262440fd0c3e90aabdf))
* **core:** detect color and style escape codes in output ([2385ce3](https://github.com/KhaledSaeed18/cliprobe/commit/2385ce375d6c20ce40f2628abb0eaeec34436a10))
* **core:** send a signal to the process group after a delay ([85ef378](https://github.com/KhaledSaeed18/cliprobe/commit/85ef378eb17456cb8258a35c3a9aa3ddd5445da8))
* report one skip when a check cannot apply to the whole target ([febb277](https://github.com/KhaledSaeed18/cliprobe/commit/febb277f77b70a7b64ff46ab80a45bd9241c1ca6))

### Bug Fixes

* escape every control and bidi character from targets in reports ([3f33452](https://github.com/KhaledSaeed18/cliprobe/commit/3f334521218277b3d7a28f33f6294e46c00ee063))
