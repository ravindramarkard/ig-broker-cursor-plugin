#!/usr/bin/env node
// Validates the plugin against Cursor's submission checklist:
// manifest schema, component frontmatter, variable declarations, and relative paths.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const errors = [];
const ok = [];
const err = (m) => errors.push(m);

const NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MANIFEST_KEYS = new Set([
  "name", "displayName", "version", "description", "author", "homepage", "repository", "license", "keywords",
  "logo", "rules", "agents", "skills", "commands", "hooks", "mcpServers", "variables", "publisher", "category",
  "tags", "minClientVersions",
]);
const VARIABLE_KEYWORDS = new Set([
  "type", "title", "description", "default", "enum", "const", "properties", "required", "items",
  "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "pattern",
]);

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch (e) {
    err(`${rel}: ${e.message}`);
    return null;
  }
}

function frontmatter(rel) {
  const text = readFileSync(join(root, rel), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) {
    err(`${rel}: missing YAML frontmatter`);
    return {};
  }
  const fm = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      fm[key] = kv[2];
    } else if (key && /^\s+/.test(line)) {
      fm[key] += ` ${line.trim()}`;
    }
  }
  if (!m[1].trim() || text.slice(m[0].length).trim().length < 20) err(`${rel}: body is empty`);
  return fm;
}

function filesIn(dir, exts) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => exts.some((e) => f.endsWith(e))).map((f) => join(dir, f));
}

// Manifest
const manifest = readJson(".cursor-plugin/plugin.json");
if (manifest) {
  for (const k of Object.keys(manifest)) if (!MANIFEST_KEYS.has(k)) err(`plugin.json: unknown field "${k}"`);
  if (!NAME_RE.test(manifest.name ?? "")) err(`plugin.json: invalid name "${manifest.name}"`);
  if (!manifest.description || manifest.description.length < 30) err("plugin.json: description is missing or too short");
  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) err("plugin.json: version must be semver");
  if (manifest.author && (typeof manifest.author.name !== "string" || Object.keys(manifest.author).some((k) => !["name", "email"].includes(k)))) {
    err("plugin.json: author must be { name, email? }");
  }
  if (manifest.logo) {
    if (/^(\/|\.\.)/.test(manifest.logo) || manifest.logo.includes("..")) err("plugin.json: logo must be a relative path");
    else if (!/^https?:/.test(manifest.logo) && !existsSync(join(root, manifest.logo))) err(`plugin.json: logo ${manifest.logo} not found`);
  }
  const vars = manifest.variables;
  if (vars) {
    if (vars.type !== "object" || typeof vars.properties !== "object") err("plugin.json: variables must be { type: object, properties }");
    const walk = (schema, path) => {
      for (const [k, v] of Object.entries(schema)) {
        if (!VARIABLE_KEYWORDS.has(k)) err(`plugin.json: variables${path}: unsupported keyword "${k}"`);
        if (k === "properties") for (const [pk, pv] of Object.entries(v)) walk(pv, `${path}.${pk}`);
        if (k === "items" && typeof v === "object") walk(v, `${path}[]`);
      }
    };
    walk(vars, "");
    for (const r of vars.required ?? []) if (!(r in vars.properties)) err(`plugin.json: required variable ${r} is not declared`);
  }
  ok.push(`manifest "${manifest.name}" v${manifest.version}`);
}

// MCP config: every ${VAR} must be declared (except the plugin root).
const mcp = readJson("mcp.json");
if (mcp && manifest) {
  const declared = new Set(Object.keys(manifest.variables?.properties ?? {}));
  const used = [...JSON.stringify(mcp).matchAll(/\$\{([A-Za-z0-9_:.-]+)\}/g)].map((m) => m[1]);
  for (const v of used) {
    if (v === "CURSOR_PLUGIN_ROOT" || v === "CLAUDE_PLUGIN_ROOT") continue;
    // ${env:NAME} is the desktop plugin settings field. NAME must still be declared.
    const name = v.startsWith("env:") ? v.slice(4) : v;
    if (!declared.has(name)) err(`mcp.json: \${${v}} is not declared in plugin.json variables`);
  }
  for (const [name, server] of Object.entries(mcp.mcpServers ?? {})) {
    for (const arg of server.args ?? []) {
      const local = arg.replace("${CURSOR_PLUGIN_ROOT}/", "");
      if (local !== arg && !existsSync(join(root, local))) err(`mcp.json: ${name} references missing file ${local} (run npm run build)`);
    }
  }
  ok.push(`mcp.json servers: ${Object.keys(mcp.mcpServers ?? {}).join(", ")}`);
}

// Rules
for (const f of filesIn("rules", [".mdc", ".md"])) {
  const fm = frontmatter(f);
  if (!fm.description) err(`${f}: rule needs a description`);
  if (fm.alwaysApply && !["true", "false"].includes(fm.alwaysApply)) err(`${f}: alwaysApply must be true/false`);
  ok.push(`rule ${f}`);
}

// Skills
if (existsSync(join(root, "skills"))) {
  for (const dir of readdirSync(join(root, "skills"))) {
    const rel = join("skills", dir, "SKILL.md");
    if (!statSync(join(root, "skills", dir)).isDirectory()) continue;
    if (!existsSync(join(root, rel))) {
      err(`skills/${dir}: missing SKILL.md`);
      continue;
    }
    const fm = frontmatter(rel);
    if (fm.name !== dir) err(`${rel}: name "${fm.name}" must match folder "${dir}"`);
    if (!KEBAB_RE.test(fm.name ?? "")) err(`${rel}: name must be kebab-case`);
    if (!fm.description || fm.description.length < 40) err(`${rel}: description too short`);
    ok.push(`skill ${fm.name}`);
  }
}

// Agents and commands
for (const [dir, label] of [["agents", "agent"], ["commands", "command"]]) {
  for (const f of filesIn(dir, [".md", ".mdc", ".markdown", ".txt"])) {
    const fm = frontmatter(f);
    if (!KEBAB_RE.test(fm.name ?? "")) err(`${f}: ${label} name must be kebab-case`);
    if (!fm.description) err(`${f}: ${label} needs a description`);
    ok.push(`${label} ${fm.name}`);
  }
}

// Hooks
const hooks = readJson("hooks/hooks.json");
if (hooks) {
  if (hooks.version !== 1) err("hooks/hooks.json: version must be 1");
  for (const [event, entries] of Object.entries(hooks.hooks ?? {})) {
    for (const h of entries) {
      const script = /\.\/(\S+\.m?js)/.exec(h.command ?? "")?.[1];
      if (script && !existsSync(join(root, script))) err(`hooks/hooks.json: ${event} script ${script} not found`);
      ok.push(`hook ${event} -> ${h.command}`);
    }
  }
}

if (!existsSync(join(root, "README.md"))) err("README.md is missing");

for (const line of ok) console.log(`  ok  ${line}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  x  ${e}`);
  process.exit(1);
}
console.log(`\nPlugin is valid (${relative(process.cwd(), root) || "."}).`);
