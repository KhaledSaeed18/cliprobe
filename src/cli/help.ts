import { VERSION } from '../version.ts';

export const HELP: string = `cliprobe ${VERSION}: test a command-line program for terminal-edge bugs

Usage:
  cliprobe [options] -- <command> [args...]

With no args after <command>, cliprobe probes "<command> --version" and
"<command> --help". With args, it probes exactly that invocation. An argument
containing {fixture} gets the path of a temporary directory of file names with
control characters in them, for the control-chars check.

Checks:
  closed-pipe   Runs the command with stdout already closed, as when output is
                piped into a reader that quits early (head, grep -q, an agent).
                A well-behaved program exits quietly; a buggy one crashes with
                an EPIPE error and a stack trace.
  color         Runs the command into a pipe, then under a terminal, then under
                a terminal with NO_COLOR=1. Fails if color codes reach a pipe;
                warns if color goes to a piped stderr or NO_COLOR is ignored.
  pipe-escapes  Runs the command into a pipe and warns if cursor movement,
                erase, hyperlink, window title or carriage-return redraw
                codes (spinners, progress bars) reach stdout or stderr.
  ctrl-c        Sends Ctrl-C (SIGINT) after 1 s. Fails if the command is still
                running 3 s later or prints a stack trace; warns if it exits 0.
                Skipped when the command finishes first, so probe a command
                that keeps running (a watcher, a server, a long task).
  control-chars Runs the command under a terminal with {fixture} replaced by a
                directory of file names holding escape sequences, a carriage
                return, a newline and more. Fails if an escape sequence reaches
                the terminal unescaped; warns for the others. Skipped without
                {fixture}, e.g. cliprobe -- ls {fixture}

Info checks (never fail; run only when named with --check):
  startup       Median wall time over 5 runs of "<command> --version", or of the
                probe as given, e.g. cliprobe --check startup -- node cli.js -v
  baseline      Appends --version, --help and an unknown flag to the probe and
                reports what scripts rely on: one version line, help on stdout,
                non-zero exit for a bad flag. A program that ignores unknown
                flags runs its default action, cut off after 5 s.

Options:
  --check <name>     Run only this check; repeat it or use commas for several
  --format <name>    Output format: human (default), json, markdown (a CI job
                     summary or PR comment) or junit (XML for CI test reports)
  --json             Same as --format json
  -o, --output-file <path>
                     Write the --format report to a file (created atomically,
                     with parent folders); the human report still prints
  --timeout <ms>     Kill a probe after this long (default 15000)
  -h, --help         Show this help
  -v, --version      Show the version

Exit codes: 0 no failures, 1 a check failed, 2 usage error or could not run.
Runs the target in the current directory without a shell, with stdin closed,
a temporary HOME and a minimal environment. Only run programs you trust.`;
