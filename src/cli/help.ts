import { VERSION } from '../version.ts';

export const HELP: string = `cliprobe ${VERSION}: test a command-line program for terminal-edge bugs

Usage:
  cliprobe [options] -- <command> [args...]

With no args after <command>, cliprobe probes "<command> --version" and
"<command> --help". With args, it probes exactly that invocation; with --bare,
the command alone. --probe adds more invocations to the same run, such as a
watch or serve command for ctrl-c and sigterm. An argument containing
{fixture} gets the path of a temporary directory of file names with control
characters in them, for the control-chars check.

Checks:
  closed-pipe   Runs the command with stdout already closed, as when output is
                piped into a reader that quits early (head, grep -q, an agent).
                A well-behaved program exits quietly; a buggy one crashes with
                an EPIPE error and a stack trace.
  color         Runs the command into a pipe, then under a terminal, then under
                a terminal with NO_COLOR=1. Fails if color codes reach a pipe;
                warns if color goes to a piped stderr or NO_COLOR is ignored.
  pipe-escapes  Runs the command into a pipe. Fails if cursor movement, erase,
                mode switch, hyperlink or window title codes (spinners,
                progress bars, prompts) reach stdout or stderr; warns if only
                carriage returns redraw a line, as a progress meter does.
  stdin         Runs the command with stdin as an open pipe nobody writes to,
                as agents and CI runners often leave it. Fails if --version or
                --help waits for input; for your own probes, warns if it
                prompts and skips if it reads stdin like a filter.
  ctrl-c        Sends Ctrl-C (SIGINT) after 1 s, with stdin left open as in a
                terminal. Fails if the command is still running 3 s later or
                prints a stack trace; warns if it exits 0, or exits and leaves
                processes running that ignored the Ctrl-C. Skipped when the
                command finishes first, so probe a command that keeps running
                (a watcher, a server, a long task), e.g. with --probe "serve".
  sigterm       Sends SIGTERM to the command alone after 1 s, as kill, docker
                stop and process managers do. Warns if it is still running 3 s
                later, prints a stack trace, or exits and leaves child
                processes running (a dev server holding its port). Skipped
                when the command finishes first, as for ctrl-c.
  restore       Runs the command under a terminal and, for your own probes,
                types Ctrl-C after 1 s, as a person would. Warns if it leaves
                the cursor hidden, the alternate screen, mouse or focus
                reporting, bracketed paste or line wrapping off, which breaks
                the shell it returns to.
  control-chars Runs the command under a terminal with {fixture} replaced by a
                directory of file names holding escape sequences, a carriage
                return, a newline and more. Fails if an escape sequence reaches
                the terminal unescaped; warns for the others. Skipped without
                {fixture}, e.g. cliprobe --probe "ls {fixture}" -- tool

Info checks (never fail; run only when named with --check):
  startup       Median wall time over 5 runs of "<command> --version", or of
                the args after <command>, e.g.
                cliprobe --check startup -- node cli.js -v
  baseline      Appends --version, --help and an unknown flag to the probe and
                reports what scripts rely on: one version line, help on stdout,
                non-zero exit for a bad flag. A program that ignores unknown
                flags runs its default action, cut off after 5 s.

Options:
  --bare             Probe the command with no arguments (a REPL, a full-screen
                     program, a server) instead of --version and --help
  --probe <args>     Also probe "<command> <args>"; repeat it for several. Split
                     like a shell command line: quotes and backslashes work,
                     variables and wildcards are not expanded. The args after
                     <command> are not kept, so name the script in each probe:
                     cliprobe --probe "./cli.js watch" -- node ./cli.js
  --check <name>     Run only this check; repeat it or use commas for several
  --skip <name>      Leave this check out; repeat it or use commas for several
  --strict           Exit 1 on a warning too, not only on a failure
  --format <name>    Output format: human (default), json, markdown (a CI job
                     summary or PR comment) or junit (XML for CI test reports)
  --json             Same as --format json
  -o, --output-file <path>
                     Write the --format report to a file (replaced atomically,
                     keeping its mode, with parent folders created; a FIFO or
                     /dev/stdout is written in place); the human report still
                     prints. For a path that starts with -, use -o=<path>
  --timeout <ms>     Kill a probe after this long (default 15000, at most
                     2147483647, about 24 days). A command still running then
                     (a server, a watcher) is judged on what it did so far,
                     and later checks watch it for 3 s
  -h, --help         Show this help
  -v, --version      Show the version

Exit codes: 0 no failures, 1 a check failed (or warned, with --strict), 2 usage
error, could not run, or could not write the --output-file report.
Runs the target in the current directory without a shell, with stdin closed
(the stdin, ctrl-c and sigterm checks use a pipe they never write to), a
temporary HOME and a minimal environment. Only run programs you trust. When a
probe exits, or when cliprobe is stopped, it kills whatever the probe left
running and removes its temporary files.`;
