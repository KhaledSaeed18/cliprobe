# Accessibility

cliprobe should be usable by everyone who works in a terminal, including people who use a screen reader or a braille display, magnification, high-contrast or custom color schemes, or who can't tell some colors apart. This statement describes what cliprobe does for that today, where it falls short, and how to report a barrier.

## Commitment

- Every piece of information is in text. Color only repeats what the words already say.
- Output is plain, line-based and predictable, so it reads the same through a screen reader as on screen.
- Accessibility problems are bugs, and they are handled like any other bug.

cliprobe also tests other programs for some of the same problems: color that ignores [`NO_COLOR`](https://no-color.org), escape sequences in piped output, and a cursor left hidden after Ctrl-C.

## How cliprobe's output works

**Verdicts are words.** Every result starts with `PASS`, `FAIL`, `WARN`, `SKIP`, `ERROR` or `INFO`, followed by the invocation and a reason in plain language. The summary line counts each verdict in words, for example `0 failed, 0 warned, 1 passed, 0 skipped`. The exit code says the same thing again; the README lists them under [Exit codes](https://github.com/KhaledSaeed18/cliprobe#exit-codes).

**Color is optional and off when it can't help.** cliprobe colors the verdict word only, and only when its output is a terminal and `NO_COLOR` is unset or empty. In a pipe, a file or CI logs there is no color at all. The colors are the terminal's own standard ones, so your terminal theme decides how they look.

**Nothing moves.** cliprobe has no spinners, progress bars, animations or cursor movement, and it doesn't switch terminal modes. It prints the report once, when the checks have finished. Error messages go to stderr as single lines starting with `cliprobe:`.

**No hidden characters.** The human report and help text are plain ASCII. Text that comes from the probed program is escaped before it is printed, so control characters can't reach your terminal or your screen reader as noise or as commands.

**Fits a standard terminal.** The help text fits in 80 columns.

**Other formats.** `--format json`, `--format markdown` and `--format junit` give the same results in a structured form, and `--output-file` writes any of them to a file. The Markdown report is a table, which a screen reader can move through by row and column, and the JSON report suits your own tools.

## Documentation

The README and the other Markdown files use real headings, lists and tables, so they can be navigated by structure. The README banner and badges have text alternatives. Code examples are text in code blocks, never images.

## Known limitations

- **Aligned columns.** The human report pads the invocation column with spaces, up to 40 characters, to line the reasons up. A longer invocation gets a row of its own, with its reason on the next line. A screen reader reads the padding as a pause, and a long reason may still wrap. `--format markdown` gives a real table instead.
- **Long evidence lines.** An evidence line can be up to 200 characters, wider than 80 columns. Longer evidence is cut at a word and ends with `... (--json has the rest)`.
- **Fixed color choice.** The verdict colors (green, red, yellow, gray, magenta and cyan, from the terminal's palette) can't be changed. Set `NO_COLOR=1` to turn them off.
- **Platforms.** cliprobe runs on macOS and Linux only. Windows isn't supported yet. Running cliprobe under WSL may work, but it isn't tested.

## Reporting a barrier

If something in cliprobe or its documentation is hard or impossible to use with the way you work, please [open an accessibility issue](https://github.com/KhaledSaeed18/cliprobe/issues/new?template=accessibility.yml). Say what you were trying to do, what you use (for example a screen reader and its version, a terminal, a color scheme) and what got in the way. If you'd rather not report it in public, email [khaled18saeed@gmail.com](mailto:khaled18saeed@gmail.com).

Barriers are triaged like bugs, and a fix that changes output follows the same [stability promise](https://github.com/KhaledSaeed18/cliprobe#stability) as any other change: the human report's wording and layout may change in a minor release, the JSON report only gains fields.

This statement was last reviewed for cliprobe 1.4.4.
