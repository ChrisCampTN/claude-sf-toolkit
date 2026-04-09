#!/usr/bin/env node
// Structural validation for the claude-sf-toolkit plugin.
// Run: node scripts/validate-plugin.js
// Exit codes: 0 = all checks pass, 1 = failures found

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

let passes = 0;
let warns = 0;
let fails = 0;

function pass(msg) {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
}

function warn(msg) {
  warns++;
  console.log(`  \x1b[33mWARN\x1b[0m  ${msg}`);
}

function fail(msg) {
  fails++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return null;
  }
}

function readFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  // Simple YAML key extraction (not a full parser)
  const fm = {};
  const raw = match[1];
  // Handle multiline values (description with >)
  let currentKey = null;
  for (const line of raw.split("\n")) {
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      fm[currentKey] = keyMatch[2].trim();
    } else if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      fm[currentKey] += "\n" + line;
    }
  }
  fm._raw = raw;
  fm._content = content;
  return fm;
}

function globMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => path.join(dir, f));
}

// ─── Check 1: JSON file validity ────────────────────────────────────────────

console.log("\n1. JSON file validity");

const jsonFiles = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "package.json",
  "hooks/hooks.json",
  "templates/sf-toolkit.json",
];

for (const file of jsonFiles) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    fail(`${file} — file not found`);
    continue;
  }
  const data = readJSON(abs);
  if (data === null) {
    fail(`${file} — invalid JSON`);
  } else {
    pass(`${file}`);
  }
}

// ─── Check 2: Version consistency ───────────────────────────────────────────

console.log("\n2. Version consistency");

const pkgVersion = readJSON(path.join(ROOT, "package.json"))?.version;
const pluginVersion = readJSON(path.join(ROOT, ".claude-plugin/plugin.json"))?.version;
const marketVersion = readJSON(path.join(ROOT, ".claude-plugin/marketplace.json"))?.plugins?.[0]?.version;

if (pkgVersion && pluginVersion && marketVersion) {
  if (pkgVersion === pluginVersion && pluginVersion === marketVersion) {
    pass(`All files at v${pkgVersion}`);
  } else {
    fail(`Version mismatch — package.json: ${pkgVersion}, plugin.json: ${pluginVersion}, marketplace.json: ${marketVersion}`);
  }
} else {
  fail("Could not read version from one or more files");
}

// ─── Check 3: Agent frontmatter ─────────────────────────────────────────────

console.log("\n3. Agent frontmatter");

const REQUIRED_AGENT_FIELDS = ["description", "model", "color"];
const VALID_COLORS = ["blue", "cyan", "green", "yellow", "magenta", "red"];
const VALID_MODELS = ["inherit", "sonnet", "opus", "haiku"];

const agentFiles = globMd(path.join(ROOT, "agents"));

for (const file of agentFiles) {
  const name = path.basename(file);
  const fm = readFrontmatter(file);

  if (!fm) {
    fail(`${name} — no YAML frontmatter found`);
    continue;
  }

  const missing = REQUIRED_AGENT_FIELDS.filter((f) => !fm[f]);
  if (missing.length > 0) {
    fail(`${name} — missing frontmatter: ${missing.join(", ")}`);
  } else {
    pass(`${name} — has all required fields`);
  }

  if (fm.color && !VALID_COLORS.includes(fm.color)) {
    fail(`${name} — invalid color: "${fm.color}" (valid: ${VALID_COLORS.join(", ")})`);
  }

  if (fm.model && !VALID_MODELS.includes(fm.model)) {
    fail(`${name} — invalid model: "${fm.model}" (valid: ${VALID_MODELS.join(", ")})`);
  }

  if (fm.description && !fm.description.includes("<example>")) {
    warn(`${name} — description has no <example> blocks (recommended for agent triggering)`);
  }
}

// ─── Check 4: Command frontmatter ───────────────────────────────────────────

console.log("\n4. Command frontmatter");

const commandDirs = ["devops", "documentation", "process"].map((d) =>
  path.join(ROOT, "commands", d)
);
// Also check root-level commands
commandDirs.push(path.join(ROOT, "commands"));

const allCommands = [];
for (const dir of commandDirs) {
  allCommands.push(...globMd(dir));
}

for (const file of allCommands) {
  const name = rel(file);
  const fm = readFrontmatter(file);
  if (!fm) {
    fail(`${name} — no YAML frontmatter`);
    continue;
  }
  if (!fm.name) {
    fail(`${name} — missing frontmatter: name`);
  }
  if (!fm.description) {
    fail(`${name} — missing frontmatter: description`);
  }
  if (fm.name && fm.description) {
    pass(`${name}`);
  }
}

// ─── Check 5: Cache-first resolution in skills ─────────────────────────────

console.log("\n5. Cache-first resolution pattern");

const RESOLUTION_MARKER = "Cache-first resolution";
const EXCLUDED_COMMANDS = ["help.md", "setup.md"]; // These don't use resolver

for (const file of allCommands) {
  const basename = path.basename(file);
  if (EXCLUDED_COMMANDS.includes(basename)) continue;

  const content = fs.readFileSync(file, "utf8");
  if (content.includes(RESOLUTION_MARKER)) {
    pass(`${rel(file)}`);
  } else {
    fail(`${rel(file)} — missing "${RESOLUTION_MARKER}" section`);
  }
}

// ─── Check 6: No stale references ──────────────────────────────────────────

console.log("\n6. No stale references");

const STALE_PATTERNS = [
  { pattern: /(?<!\.\/)\.sf-toolkit-cache\.json/g, label: "bare .sf-toolkit-cache.json (should be .claude/sf-toolkit-cache.json)" },
  { pattern: /claude plugin path/g, label: 'claude plugin path (should be ${CLAUDE_PLUGIN_ROOT})' },
  { pattern: /\$\(dirname.*realpath/g, label: "$(dirname...realpath...) fragile path pattern" },
  { pattern: /Dispatch the `sf-toolkit-resolve` agent\. Use the returned/g, label: "old resolver dispatch pattern" },
];

const scanDirs = ["commands", "agents"];
const filesToScan = [];
for (const dir of scanDirs) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  // Recursively find .md files
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else if (entry.name.endsWith(".md")) filesToScan.push(path.join(d, entry.name));
    }
  };
  walk(abs);
}

let staleFound = false;
for (const file of filesToScan) {
  const content = fs.readFileSync(file, "utf8");
  const name = rel(file);
  for (const { pattern, label } of STALE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    if (match) {
      // Skip if it's in a "never do this" context (CLAUDE.md negative examples)
      const lineStart = content.lastIndexOf("\n", match.index) + 1;
      const line = content.slice(lineStart, content.indexOf("\n", match.index));
      if (line.includes("never") || line.includes("Never") || line.includes("not")) continue;
      fail(`${name} — stale reference: ${label}`);
      staleFound = true;
    }
  }
}
if (!staleFound) {
  pass("No stale references found");
}

// ─── Check 7: Referenced scripts exist ──────────────────────────────────────

console.log("\n7. Script template references");

const scriptTemplateDir = path.join(ROOT, "script-templates");
const scriptFiles = fs.existsSync(scriptTemplateDir)
  ? fs.readdirSync(scriptTemplateDir).filter((f) => f.endsWith(".js"))
  : [];

// Find all script references in commands/agents
const scriptRefs = new Set();
for (const file of filesToScan) {
  const content = fs.readFileSync(file, "utf8");
  const matches = content.matchAll(/script-templates\/([a-z-]+\.js)/g);
  for (const m of matches) scriptRefs.add(m[1]);
  const localMatches = content.matchAll(/scripts\/([a-z-]+\.js)/g);
  for (const m of localMatches) scriptRefs.add(m[1]);
}

for (const ref of scriptRefs) {
  if (scriptFiles.includes(ref)) {
    pass(`${ref} — exists in script-templates/`);
  } else {
    warn(`${ref} — referenced but not found in script-templates/ (may be local-only)`);
  }
}

// ─── Check 8: hooks.json structure ──────────────────────────────────────────

console.log("\n8. hooks.json structure");

const hooksData = readJSON(path.join(ROOT, "hooks/hooks.json"));
if (hooksData) {
  if (hooksData.hooks) {
    pass("Has plugin wrapper format (hooks key)");
  } else {
    fail("Missing plugin wrapper — needs { hooks: { ... } } format");
  }

  const hooksContent = JSON.stringify(hooksData);
  if (hooksContent.includes("CLAUDE_PLUGIN_ROOT")) {
    pass("Uses ${CLAUDE_PLUGIN_ROOT} for paths");
  } else {
    warn("No ${CLAUDE_PLUGIN_ROOT} references found in hooks.json");
  }

  const events = Object.keys(hooksData.hooks || {});
  if (events.length > 0) {
    pass(`Registered events: ${events.join(", ")}`);
  } else {
    warn("No hook events registered");
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(50));
console.log(
  `  \x1b[32m${passes} passed\x1b[0m` +
    (warns > 0 ? `  \x1b[33m${warns} warnings\x1b[0m` : "") +
    (fails > 0 ? `  \x1b[31m${fails} failed\x1b[0m` : "")
);
console.log("─".repeat(50) + "\n");

process.exit(fails > 0 ? 1 : 0);
