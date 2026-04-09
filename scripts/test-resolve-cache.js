#!/usr/bin/env node
// Unit tests for script-templates/resolve-cache.js
// Run: node scripts/test-resolve-cache.js
// Exit codes: 0 = all pass, 1 = failures

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "script-templates", "resolve-cache.js");
const TMP = path.join(__dirname, "..", ".test-cache-tmp");

let passes = 0;
let fails = 0;

function setup() {
  fs.mkdirSync(TMP, { recursive: true });
  // resolve-cache.js uses __dirname/../ as REPO_ROOT, so we need a .claude/ dir
  fs.mkdirSync(path.join(TMP, ".claude"), { recursive: true });
}

function cleanup() {
  fs.rmSync(TMP, { recursive: true, force: true });
}

function writeCache(data, filename = ".claude/sf-toolkit-cache.json") {
  const filePath = path.join(TMP, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function run(extraArgs = "") {
  const cachePath = path.join(TMP, ".claude", "sf-toolkit-cache.json");
  try {
    const cmd = `node "${SCRIPT}" --cache-path "${cachePath}" ${extraArgs}`;
    const stdout = execSync(cmd, { cwd: TMP, encoding: "utf8", timeout: 5000 });
    return { code: 0, output: JSON.parse(stdout.trim()) };
  } catch (err) {
    try {
      return { code: err.status, output: JSON.parse(err.stdout.trim()) };
    } catch {
      return { code: err.status, output: null, raw: err.stdout };
    }
  }
}

function test(name, fn) {
  try {
    fn();
    passes++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } catch (err) {
    fails++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}`);
    console.log(`         ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

console.log("\nresolve-cache.js unit tests\n");

// Clean up any leftover tmp from a previous failed run
cleanup();

// --- Missing file ---

console.log("Missing cache file:");

test("returns invalid when cache file doesn't exist", () => {
  setup();
  const { code, output } = run();
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("not found"), `reason: ${output.reason}`);
  assertEqual(code, 1, "exit code");
  cleanup();
});

// --- Invalid JSON ---

console.log("\nInvalid cache file:");

test("returns invalid for unparseable JSON", () => {
  setup();
  fs.writeFileSync(path.join(TMP, ".claude/sf-toolkit-cache.json"), "not json{{{");
  const { code, output } = run();
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("parse error"), `reason: ${output.reason}`);
  assertEqual(code, 1, "exit code");
  cleanup();
});

// --- Missing metadata ---

console.log("\nMissing cache metadata:");

test("returns invalid when _cache is missing", () => {
  setup();
  writeCache({ orgs: { dev: "test" } });
  const { code, output } = run();
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("Missing cache metadata"), `reason: ${output.reason}`);
  cleanup();
});

test("returns invalid when expiresAt is missing", () => {
  setup();
  writeCache({ _cache: { resolvedAt: new Date().toISOString() }, orgs: {} });
  const { code, output } = run();
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("Missing cache metadata"), `reason: ${output.reason}`);
  cleanup();
});

// --- Expired cache ---

console.log("\nExpired cache:");

test("returns invalid when cache is expired", () => {
  setup();
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
  writeCache({
    _cache: {
      resolvedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      expiresAt: past.toISOString(),
      ttlHours: 24,
    },
    orgs: { dev: "test" },
  });
  const { code, output } = run();
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("expired"), `reason: ${output.reason}`);
  assertEqual(code, 1, "exit code");
  cleanup();
});

// --- Valid cache ---

console.log("\nValid cache:");

test("returns valid with context when cache is fresh", () => {
  setup();
  const future = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now
  writeCache({
    _cache: {
      resolvedAt: new Date().toISOString(),
      expiresAt: future.toISOString(),
      ttlHours: 24,
    },
    orgs: { dev: "my-sandbox", devAlias: "MySandbox" },
    apiVersion: "62.0",
  });
  const { code, output } = run();
  assertEqual(output.valid, true, "valid");
  assertEqual(output.context.orgs.dev, "my-sandbox", "orgs.dev");
  assertEqual(output.context.apiVersion, "62.0", "apiVersion");
  assert(!output.context._cache, "_cache should be stripped from context");
  assertEqual(code, 0, "exit code");
  cleanup();
});

test("returns age and expiresIn fields", () => {
  setup();
  const future = new Date(Date.now() + 6 * 60 * 60 * 1000);
  writeCache({
    _cache: {
      resolvedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      expiresAt: future.toISOString(),
      ttlHours: 24,
    },
    orgs: {},
  });
  const { code, output } = run();
  assertEqual(output.valid, true, "valid");
  assert(typeof output.ageHours === "number", "ageHours should be a number");
  assert(output.ageHours >= 0.9 && output.ageHours <= 1.2, `ageHours ~1.0: ${output.ageHours}`);
  assert(output.expiresIn.endsWith("h"), `expiresIn format: ${output.expiresIn}`);
  cleanup();
});

// --- Invalidate mode ---

console.log("\nInvalidate mode:");

test("--invalidate deletes the cache file", () => {
  setup();
  const future = new Date(Date.now() + 12 * 60 * 60 * 1000);
  writeCache({
    _cache: { resolvedAt: new Date().toISOString(), expiresAt: future.toISOString(), ttlHours: 24 },
    orgs: {},
  });
  assert(fs.existsSync(path.join(TMP, ".claude/sf-toolkit-cache.json")), "cache should exist before invalidate");
  const { output } = run("--invalidate");
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("invalidated"), `reason: ${output.reason}`);
  assert(!fs.existsSync(path.join(TMP, ".claude/sf-toolkit-cache.json")), "cache should be deleted");
  cleanup();
});

test("--invalidate is no-op when file doesn't exist", () => {
  setup();
  const { output } = run("--invalidate");
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("No cache file"), `reason: ${output.reason}`);
  cleanup();
});

// --- Mtime checking ---

console.log("\nMtime validation (--check-mtimes):");

test("valid cache with matching mtimes passes", () => {
  setup();
  // Use a real file (mtime paths are resolved against the script's REPO_ROOT = script-templates/../)
  // So we use the plugin's own package.json as a stable test subject
  const pluginRoot = path.join(path.dirname(SCRIPT), "..");
  const realFile = path.join(pluginRoot, "package.json");
  const relPath = "package.json";
  const mtime = fs.statSync(realFile).mtime.toISOString();

  const future = new Date(Date.now() + 12 * 60 * 60 * 1000);
  writeCache({
    _cache: {
      resolvedAt: new Date().toISOString(),
      expiresAt: future.toISOString(),
      ttlHours: 24,
      sourceFiles: { [relPath]: mtime },
    },
    orgs: {},
  });
  const { output } = run("--check-mtimes");
  assertEqual(output.valid, true, "valid");
  cleanup();
});

test("detects removed source file", () => {
  setup();
  const future = new Date(Date.now() + 12 * 60 * 60 * 1000);
  writeCache({
    _cache: {
      resolvedAt: new Date().toISOString(),
      expiresAt: future.toISOString(),
      ttlHours: 24,
      sourceFiles: { "definitely-nonexistent-file-abc123.txt": "2026-01-01T00:00:00.000Z" },
    },
    orgs: {},
  });
  const { output } = run("--check-mtimes");
  assertEqual(output.valid, false, "valid");
  assert(output.reason.includes("removed"), `reason: ${output.reason}`);
  cleanup();
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(50));
console.log(
  `  \x1b[32m${passes} passed\x1b[0m` +
    (fails > 0 ? `  \x1b[31m${fails} failed\x1b[0m` : "")
);
console.log("─".repeat(50) + "\n");

process.exit(fails > 0 ? 1 : 0);
