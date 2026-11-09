import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/cliprobe.js", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));

function cliprobe(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function probeJson(...command) {
  const r = cliprobe("--json", "--timeout", "3000", "--", ...command);
  return { status: r.status, report: JSON.parse(r.stdout) };
}

test("a raw process.stdout.write crashes and fails the check", () => {
  const { status, report } = probeJson(process.execPath, fixture("crash"));
  assert.equal(status, 1);
  assert.equal(report.results[0].verdict, "fail");
  assert.match(report.results[0].evidence, /EPIPE|Unhandled 'error'/);
});

test("console.log passes, because console swallows stream errors", () => {
  const { status, report } = probeJson(process.execPath, fixture("clean"));
  assert.equal(status, 0);
  assert.equal(report.results[0].verdict, "pass");
});

test("a program that handles EPIPE passes", () => {
  const { report } = probeJson(process.execPath, fixture("handled"));
  assert.equal(report.results[0].verdict, "pass");
});

test("a fast native program stopped by SIGPIPE passes, deterministically", () => {
  for (let i = 0; i < 10; i++) {
    const { report } = probeJson("printf", "hello\\n");
    assert.equal(report.results[0].verdict, "pass");
    assert.equal(report.results[0].closed.signal, "SIGPIPE");
  }
});

test("a program that writes nothing to stdout is skipped", () => {
  const { status, report } = probeJson(process.execPath, fixture("silent"));
  assert.equal(status, 0);
  assert.equal(report.results[0].verdict, "skip");
});

test("a program that hangs only after stdout closes fails", () => {
  const { status, report } = probeJson(process.execPath, fixture("hang"));
  assert.equal(status, 1);
  assert.equal(report.results[0].verdict, "fail");
  assert.equal(report.results[0].closed.timedOut, true);
});

test("control characters from the target are escaped in human output", () => {
  const r = cliprobe("--timeout", "3000", "--", process.execPath, fixture("ctrl"));
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes("\u001b]0;"), "raw OSC escape leaked to the terminal");
  assert.match(r.stdout, /\\x1b\]0;pwned\\x07/);
});

test("a missing command is reported as could-not-run with exit 2", () => {
  const { status, report } = probeJson("cliprobe-no-such-command-xyz");
  assert.equal(status, 2);
  assert.ok(report.results.every((r) => r.verdict === "error"));
});

test("with no args it probes --version and --help", () => {
  const { report } = probeJson("node");
  assert.deepEqual(report.results.map((r) => r.invocation.slice(1)), [["--version"], ["--help"]]);
});

test("usage errors exit 2", () => {
  assert.equal(cliprobe().status, 2);
  assert.equal(cliprobe("--bogus").status, 2);
  assert.equal(cliprobe("--timeout", "abc", "--", "node").status, 2);
});

test("cliprobe itself survives a closed stdout", () => {
  const r = cliprobe("--json", "--", process.execPath, fixture("clean"));
  assert.equal(r.status, 0);
  const self = probeJson(process.execPath, BIN, "--help");
  assert.equal(self.report.results[0].verdict, "pass");
});

test("a relative command path is resolved from the caller's directory", () => {
  const r = spawnSync(process.execPath, [BIN, "--json", "--", "./test/fixtures/run-crash.sh"], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  const report = JSON.parse(r.stdout);
  assert.equal(report.results[0].verdict, "fail");
});

test("relative arguments are resolved from the caller's directory", () => {
  const r = spawnSync(process.execPath, [BIN, "--json", "--", "node", "./test/fixtures/crash.mjs"], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  assert.equal(JSON.parse(r.stdout).results[0].verdict, "fail");
});
