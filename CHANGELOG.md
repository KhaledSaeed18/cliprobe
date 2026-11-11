# Changelog

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
