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

// ─── workTracking validation ───────────────────────────────────────────────

const VALID_BACKENDS = ["devops-center", "github-actions"];
const WORK_TRACKING_REQUIRED = [
  "backend",
  "branchPattern",
  "idPrefix",
  "idPattern",
  "deployManagedEnvs",
  "deployLocalEnvs",
  "disabledSkills",
];
const GHA_REQUIRED = ["issueRepo", "listActiveCmd"];

function validateWorkTracking(wt) {
  if (!wt || typeof wt !== "object") {
    return { valid: false, error: "workTracking must be an object" };
  }
  for (const field of WORK_TRACKING_REQUIRED) {
    if (!(field in wt)) {
      return { valid: false, error: `missing required field: ${field}` };
    }
  }
  if (!VALID_BACKENDS.includes(wt.backend)) {
    return {
      valid: false,
      error: `unknown backend: ${wt.backend} (expected: ${VALID_BACKENDS.join(", ")})`,
    };
  }
  if (!Array.isArray(wt.deployManagedEnvs)) {
    return { valid: false, error: "deployManagedEnvs must be an array" };
  }
  if (!Array.isArray(wt.deployLocalEnvs)) {
    return { valid: false, error: "deployLocalEnvs must be an array" };
  }
  if (!Array.isArray(wt.disabledSkills)) {
    return { valid: false, error: "disabledSkills must be an array" };
  }
  if (wt.backend === "github-actions") {
    for (const field of GHA_REQUIRED) {
      if (!wt[field]) {
        return { valid: false, error: `GHA backend missing required field: ${field}` };
      }
    }
  }
  return { valid: true, error: null };
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

// ─── workTracking schema validation ────────────────────────────────────────

console.log("\n  workTracking schema:");

test("valid DOC workTracking has required fields", () => {
  const wt = {
    backend: "devops-center",
    branchPattern: "WI-{id}",
    idPrefix: "WI-",
    idPattern: "WI-\\d{6}",
    listActiveCmd: null,
    deployManagedEnvs: [],
    deployLocalEnvs: ["dev", "staging", "production"],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(result.valid, "DOC workTracking should be valid: " + result.error);
});

test("valid GHA workTracking has required fields", () => {
  const wt = {
    backend: "github-actions",
    issueRepo: "owner/repo",
    branchPattern: "feature/issue-{id}-{slug}",
    idPrefix: "#",
    idPattern: "#\\d+",
    listActiveCmd: "gh issue list --repo owner/repo --state open --json number,title,state,labels,assignees",
    listAllCmd: "gh issue list --repo owner/repo --state all --json number,title,state,labels,assignees --limit 100",
    viewItemCmd: "gh issue view {id} --repo owner/repo --json number,title,body,state,labels,assignees,comments",
    createItemCmd: 'gh issue create --repo owner/repo --title "{title}" --body-file {bodyFile}',
    deployManagedEnvs: ["staging", "production"],
    deployLocalEnvs: ["dev"],
    disabledSkills: ["devops-commit", "wi-sync"],
  };
  const result = validateWorkTracking(wt);
  assert(result.valid, "GHA workTracking should be valid: " + result.error);
});

test("workTracking missing backend fails", () => {
  const wt = { branchPattern: "WI-{id}", idPrefix: "WI-", idPattern: "WI-\\d{6}" };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "Missing backend should fail");
});

test("workTracking with unknown backend fails", () => {
  const wt = {
    backend: "jenkins",
    branchPattern: "feat-{id}",
    idPrefix: "#",
    idPattern: "#\\d+",
    deployManagedEnvs: [],
    deployLocalEnvs: [],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "Unknown backend should fail");
});

test("GHA workTracking missing issueRepo fails", () => {
  const wt = {
    backend: "github-actions",
    branchPattern: "feature/issue-{id}-{slug}",
    idPrefix: "#",
    idPattern: "#\\d+",
    listActiveCmd: "gh issue list",
    deployManagedEnvs: [],
    deployLocalEnvs: [],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "GHA missing issueRepo should fail");
});

test("workTracking missing deployManagedEnvs fails", () => {
  const wt = {
    backend: "devops-center",
    branchPattern: "WI-{id}",
    idPrefix: "WI-",
    idPattern: "WI-\\d{6}",
    listActiveCmd: null,
    deployLocalEnvs: ["dev"],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "Missing deployManagedEnvs should fail");
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(50));
console.log(
  `  \x1b[32m${passes} passed\x1b[0m` +
    (fails > 0 ? `  \x1b[31m${fails} failed\x1b[0m` : "")
);
console.log("─".repeat(50) + "\n");

process.exit(fails > 0 ? 1 : 0);
