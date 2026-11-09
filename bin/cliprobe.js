#!/usr/bin/env node
// cliprobe: black-box tests a command-line program for terminal-edge bugs.
// 0.0.1 ships one check: does the program crash when its stdout is closed?
import { spawn, execFileSync } from "node:child_process";
import { closeSync, constants, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const STDERR_CAP = 64 * 1024;
// Signs that a program reported a write failure or crashed with a stack trace.
const ERROR_RE = /EPIPE|broken ?pipe|BrokenPipeError|Unhandled 'error' event|^\s+at .+:\d+:\d+\)?$/im;

const HELP = `cliprobe ${VERSION}: test a command-line program for terminal-edge bugs

Usage:
  cliprobe [options] -- <command> [args...]

With no args after <command>, cliprobe probes "<command> --version" and
"<command> --help". With args, it probes exactly that invocation.

Checks (0.0.1):
  closed-pipe   Runs the command with stdout already closed, as when output is
                piped into a reader that quits early (head, grep -q, an agent).
                A well-behaved program exits quietly; a buggy one crashes with
                an EPIPE error and a stack trace.

Options:
  --json             Print results as JSON
  --timeout <ms>     Kill a probe after this long (default 15000)
  -h, --help         Show this help
  -v, --version      Show the version

Exit codes: 0 no failures, 1 a check failed, 2 usage error or could not run.
Runs the target in the current directory without a shell, with stdin closed,
a temporary HOME and a minimal environment. Only run programs you trust.`;

function parseArgs(argv) {
  const opts = { json: false, timeout: 15000, command: null, args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      [opts.command, ...opts.args] = argv.slice(i + 1);
      break;
    }
    if (a === "--json") opts.json = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a === "--timeout" || a.startsWith("--timeout=")) {
      const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      opts.timeout = Number(value);
      if (!Number.isInteger(opts.timeout) || opts.timeout <= 0) throw new UsageError(`--timeout needs a positive whole number of milliseconds, got "${value}"`);
    } else if (a.startsWith("-")) throw new UsageError(`unknown option "${a}"`);
    else {
      // No "--": the first bare argument starts the command.
      [opts.command, ...opts.args] = argv.slice(i);
      break;
    }
  }
  return opts;
}

class UsageError extends Error {}

/** Escapes control characters so a target's output cannot drive our terminal. */
function safe(text) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "cliprobe-"));
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: process.env.LANG ?? "C.UTF-8",
    HOME: dir,
    TMPDIR: dir,
    TERM: "dumb",
    CI: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
  return { dir, env };
}

/**
 * Runs one invocation. With `closedStdout`, stdout is the write end of a FIFO
 * whose read end is closed before the program starts, so its first write to
 * stdout fails (EPIPE, or SIGPIPE for programs that keep the default handler).
 */
function run(command, args, { closedStdout, timeout }) {
  const { dir, env } = sandbox();
  let stdoutFd = "pipe";
  if (closedStdout) {
    const fifo = join(dir, "stdout.fifo");
    execFileSync("mkfifo", [fifo]);
    const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    stdoutFd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    closeSync(reader);
  }

  return new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderr = "";
    let timedOut = false;
    let child;
    let finished = false;
    // A failed spawn emits both "error" and "close"; clean up and resolve once.
    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (typeof stdoutFd === "number") closeSync(stdoutFd);
      rmSync(dir, { recursive: true, force: true });
      resolve({ stdoutBytes, stderr, timedOut, ...result });
    };
    try {
      // Runs in the caller's directory, as if typed there, so relative paths such as
      // `node ./dist/cli.js` work. HOME and TMPDIR point at a throwaway directory.
      child = spawn(command, args, { env, stdio: ["ignore", stdoutFd, "pipe"], detached: true });
    } catch (error) {
      return finish({ spawnError: error.message });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }, timeout);
    child.stdout?.on("data", (chunk) => { stdoutBytes += chunk.length; });
    child.stderr.on("data", (chunk) => { if (stderr.length < STDERR_CAP) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); finish({ spawnError: error.message }); });
    child.on("close", (exitCode, signal) => { clearTimeout(timer); finish({ exitCode, signal }); });
  });
}

/**
 * Picks the most useful evidence from a crash: the error message plus the first
 * stack frame in the program's own code (not Node internals), which usually
 * points at the unguarded write.
 */
function crashEvidence(stderr) {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  const message = lines.find((l) => /^(\w*Error\b|panic:)/.test(l)) ?? lines.find((l) => ERROR_RE.test(l)) ?? lines[0] ?? "";
  const frame = lines.find((l) => l.startsWith("at ") && !/\bnode:/.test(l))?.match(/(?:file:\/\/)?(\/[^\s()]+:\d+:\d+)/)?.[1];
  if (!frame) return message;
  const cwd = process.cwd() + "/";
  return `${message} (at ${frame.startsWith(cwd) ? frame.slice(cwd.length) : frame})`;
}

function judge(base, closed) {
  if (base.spawnError) return { verdict: "error", reason: `could not start: ${base.spawnError}` };
  if (base.timedOut) return { verdict: "error", reason: "timed out on a normal run" };
  if (base.stdoutBytes === 0) return { verdict: "skip", reason: "wrote nothing to stdout, so a closed stdout is never touched" };
  if (closed.timedOut) return { verdict: "fail", reason: "hung after stdout was closed" };
  if (closed.signal === "SIGPIPE") return { verdict: "pass", reason: "stopped by SIGPIPE, the conventional exit" };
  const newError = ERROR_RE.test(closed.stderr) && !ERROR_RE.test(base.stderr);
  if (newError && closed.exitCode !== base.exitCode) {
    return { verdict: "fail", reason: `crashed when stdout was closed (exit ${base.exitCode} -> ${closed.exitCode})`, evidence: crashEvidence(closed.stderr) };
  }
  if (newError) return { verdict: "warn", reason: "printed a write error but kept its exit code", evidence: crashEvidence(closed.stderr) };
  if (closed.exitCode !== base.exitCode) return { verdict: "pass", reason: `exited quietly with code ${closed.exitCode}` };
  return { verdict: "pass", reason: "exited quietly" };
}

async function probe(command, args, timeout) {
  const base = await run(command, args, { closedStdout: false, timeout });
  const closed = await run(command, args, { closedStdout: true, timeout });
  return {
    check: "closed-pipe",
    invocation: [command, ...args],
    ...judge(base, closed),
    baseline: { exitCode: base.exitCode ?? null, signal: base.signal ?? null, stdoutBytes: base.stdoutBytes },
    closed: { exitCode: closed.exitCode ?? null, signal: closed.signal ?? null, timedOut: closed.timedOut, stderr: closed.stderr.slice(-2000) },
  };
}

const COLORS = { pass: 32, fail: 31, warn: 33, skip: 90, error: 35 };

function printHuman(command, results, useColor) {
  const paint = (verdict) => {
    const label = verdict.toUpperCase().padEnd(5);
    return useColor ? `\x1b[${COLORS[verdict]}m${label}\x1b[0m` : label;
  };
  const width = Math.max(...results.map((r) => safe(r.invocation.join(" ")).length));
  console.log(`cliprobe ${VERSION}: closed-pipe check for ${safe(command)}\n`);
  for (const r of results) {
    console.log(`  ${paint(r.verdict)}  ${safe(r.invocation.join(" ")).padEnd(width)}  ${r.reason}`);
    if (r.evidence) console.log(`  ${" ".repeat(5)}  ${" ".repeat(width)}  ${safe(r.evidence).slice(0, 200)}`);
  }
  const count = (v) => results.filter((r) => r.verdict === v).length;
  console.log(`\n${count("fail")} failed, ${count("warn")} warned, ${count("pass")} passed, ${count("skip")} skipped${count("error") ? `, ${count("error")} could not run` : ""}`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`cliprobe: ${error.message}\nRun "cliprobe --help" for usage.`);
    return 2;
  }
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }
  if (!opts.command) { console.error(`cliprobe: no command given\nUsage: cliprobe [options] -- <command> [args...]`); return 2; }
  if (process.platform === "win32") { console.error("cliprobe: Windows is not supported yet (the closed-pipe check needs mkfifo)."); return 2; }

  const invocations = opts.args.length ? [opts.args] : [["--version"], ["--help"]];
  const results = [];
  for (const args of invocations) results.push(await probe(opts.command, args, opts.timeout));

  if (opts.json) {
    console.log(JSON.stringify({ tool: "cliprobe", version: VERSION, command: opts.command, results }, null, 2));
  } else {
    const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
    printHuman(opts.command, results, useColor);
  }
  if (results.some((r) => r.verdict === "fail")) return 1;
  if (results.every((r) => r.verdict === "error")) return 2;
  return 0;
}

// cliprobe practises what it checks: a closed stdout ends it quietly.
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
  throw error;
});

process.exitCode = await main();
