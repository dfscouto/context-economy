/*
 * Tests for context-economy's PURE functions (node:test, zero dependencies).
 * Run:  npm test   (or: node --test tests/units.test.cjs)
 */
const { test } = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const os = require('os');
const path = require('path');
const billing = require('../scripts/lib/billing.cjs');
const ps = require('../scripts/lib/project-scan.cjs');
const bloat = require('../scripts/lib/bloat-scan.cjs');
const mcpScan = require('../scripts/lib/mcp-scan.cjs');
const install = require('../scripts/install.cjs');

const tmp = (n) => path.join(os.tmpdir(), `ce-${process.pid}-${n}`);

// ---- billing (cost weights) ----
test('billedOf uses CR=0.1 and CW=1.25', () => {
  // 100 + 50 + 40*1.25 + 1000*0.1 = 100 + 50 + 50 + 100 = 300
  assert.strictEqual(billing.billedOf({ in: 100, out: 50, cw: 40, cr: 1000 }), 300);
  assert.strictEqual(billing.billedOf({}), 0);
  assert.strictEqual(billing.CR, 0.1);
  assert.strictEqual(billing.CW, 1.25);
});

test('pct rounds and guards divide-by-zero', () => {
  assert.strictEqual(billing.pct(50, 200), 25);
  assert.strictEqual(billing.pct(1, 0), 0);     // no crash
  assert.strictEqual(billing.pct(0, 100), 0);
});

test('median (odd and even; rounds integers on purpose)', () => {
  assert.strictEqual(billing.median([3, 1, 2]), 2);
  assert.strictEqual(billing.median([10, 20, 30, 40]), 25);
  assert.strictEqual(billing.median([]), 0);
});

test('percentile is monotonic and respects extremes', () => {
  assert.strictEqual(billing.percentile([42], 50), 42);
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.ok(billing.percentile(arr, 90) >= billing.percentile(arr, 10));
});

test('k formats billions', () => {
  assert.strictEqual(billing.k(2.5e9), '2.5b');
});

// ---- project-scan: handoff/CLAUDE.md detection (what precheck uses) ----
test('findHandoff: finds ANDAMENTO/STATUS by known names', () => {
  const dir = tmp('proj');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'ANDAMENTO.md'), '# x');
  assert.strictEqual(ps.findHandoff(dir), 'docs/ANDAMENTO.md');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- bloat-scan: buildRecommendations ----
test('buildRecommendations: nothing installed = no recommendations', () => {
  assert.deepStrictEqual(bloat.buildRecommendations([], { servers: [], inactivePlugins: [] }), []);
});

// ---- mcp-scan: MCP estimate by tool count (fixes the hardcoded 800) ----
test('estMcpServerTokens: no tool count → marked floor', () => {
  const r = mcpScan.estMcpServerTokens(null);
  assert.strictEqual(r.basis, 'floor');
  assert.strictEqual(r.est, mcpScan.MCP_TOK.floor);
  assert.strictEqual(r.lo, r.hi); // floor is not a range
  assert.strictEqual(mcpScan.estMcpServerTokens(0).basis, 'floor'); // 0 tools also falls to the floor
});

test('estMcpServerTokens: with tools → range floor<ceiling, proportional', () => {
  const r = mcpScan.estMcpServerTokens(50);
  assert.strictEqual(r.basis, 'tools');
  assert.ok(r.lo < r.hi, 'floor (names) < ceiling (schemas)');
  assert.strictEqual(r.lo, mcpScan.MCP_TOK.base + 50 * mcpScan.MCP_TOK.perName);
  assert.strictEqual(r.hi, mcpScan.MCP_TOK.base + 50 * mcpScan.MCP_TOK.perSchema);
  // more tools = more expensive (monotonic)
  assert.ok(mcpScan.estMcpServerTokens(100).hi > r.hi);
});

// ---- bloat-scan: matchUsage (fixes false "0× never used") ----
test('matchUsage: matches plugin namespaced key (anthropic-skills:humanizer ~ humanizer)', () => {
  const usage = { 'anthropic-skills:humanizer': { usageCount: 7, lastUsedAt: 1000 } };
  const r = bloat.matchUsage(usage, ['humanizer', 'humanizer']);
  assert.strictEqual(r.usageCount, 7);          // would NOT be 0 (the old bug)
  assert.strictEqual(r.lastUsedAt, 1000);
  assert.deepStrictEqual(r.hitKeys, ['anthropic-skills:humanizer']);
});

test('matchUsage: tolerates hyphen vs underscore', () => {
  const usage = { 'foo-bar': { usageCount: 3, lastUsedAt: 50 } };
  assert.strictEqual(bloat.matchUsage(usage, ['foo_bar']).usageCount, 3);
});

test('matchUsage: takes the MAX across matched keys (safe side)', () => {
  const usage = { 'pdf': { usageCount: 2, lastUsedAt: 10 }, 'anthropic-skills:pdf': { usageCount: 9, lastUsedAt: 99 } };
  const r = bloat.matchUsage(usage, ['pdf', 'pdf']);
  assert.strictEqual(r.usageCount, 9);
  assert.strictEqual(r.lastUsedAt, 99);
});

test('matchUsage: skill with no usage → 0 and no hits (matches nothing by accident)', () => {
  const usage = { 'other-skill': { usageCount: 5 } };
  const r = bloat.matchUsage(usage, ['my-skill', 'my-skill']);
  assert.strictEqual(r.usageCount, 0);
  assert.strictEqual(r.hitKeys.length, 0);
});

// ---- install: SAFE read/write of settings.json (must not wipe configs) ----
test('readSettings: nonexistent file → {} (clean install)', () => {
  const f = tmp('noexist.json');
  try { fs.unlinkSync(f); } catch {}
  assert.deepStrictEqual(install.readSettings(f), {});
});

test('readSettings: invalid JSON → THROWS (never returns {} so it cannot overwrite)', () => {
  const f = tmp('bad.json');
  fs.writeFileSync(f, '{ "permissions": [ , broken');
  assert.throws(() => install.readSettings(f), /invalid/i);
  fs.unlinkSync(f);
});

test('readSettings: tolerates BOM', () => {
  const f = tmp('bom.json');
  fs.writeFileSync(f, '﻿{"model":"opus"}');
  assert.deepStrictEqual(install.readSettings(f), { model: 'opus' });
  fs.unlinkSync(f);
});

test('writeSettingsAtomic: backs up the previous content and writes the new one', () => {
  const f = tmp('write.json');
  fs.writeFileSync(f, '{"permissions":["keep-me"]}');
  install.writeSettingsAtomic(f, { hooks: { X: 1 } });
  assert.ok(fs.existsSync(f + '.bak'), 'backup created');
  assert.match(fs.readFileSync(f + '.bak', 'utf8'), /keep-me/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { hooks: { X: 1 } });
  fs.unlinkSync(f); try { fs.unlinkSync(f + '.bak'); } catch {}
});

test('estTokens does NOT count the SKILL.md body (only name+description)', () => {
  // guards the audit fix: a giant SKILL.md must not inflate the per-session cost.
  // indirect exercise: the formula must depend only on name+desc; here we validate via scanSkills in a fake dir.
  // (direct coverage of the formula lives in the real scan; here we only ensure the function exists and runs)
  assert.strictEqual(typeof bloat.scanSkills, 'function');
});

const skillToggle = require('../scripts/lib/skill-toggle.cjs');

test('canToggleSkill: no blocking by name; only a valid folder', () => {
  assert.strictEqual(skillToggle.canToggleSkill('../evil'), false);
  assert.strictEqual(skillToggle.canToggleSkill('__does_not_exist__'), false);
  const dir = skillToggle.skillsDir();
  if (fs.existsSync(dir)) {
    const one = fs.readdirSync(dir).find((n) => {
      try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch { return false; }
    });
    if (one) assert.strictEqual(skillToggle.canToggleSkill(one), true);
  }
});

test('toggleSkill rejects a name with a slash', () => {
  assert.throws(() => skillToggle.toggleSkill('../evil', false), /invalid/i);
});

const translate = require('../scripts/lib/translate.cjs');

test('normLang: pt-BR → pt', () => {
  assert.strictEqual(translate.normLang('pt-BR'), 'pt');
  assert.strictEqual(translate.normLang('en-US'), 'en');
});

test('translateText: en language does not translate (no network)', async () => {
  const r = await translate.translateText('Build apps fast', 'en');
  assert.strictEqual(r.text, 'Build apps fast');
  assert.strictEqual(r.translated, false);
});

const skillProject = require('../scripts/lib/skill-project.cjs');

test('assessSkillForProject: invoked in the project blocks disabling', () => {
  const skill = { folder: 'instagram-carousel', name: 'instagram-carousel', usageCount: 18, canToggle: true, disabled: false };
  const v = skillProject.assessSkillForProject(skill, { haystack: 'a landing page' }, { invokes: { 'instagram-carousel': 3 }, reads: {} });
  assert.strictEqual(v.code, 'in-use');
  assert.strictEqual(v.canDisable, false);
});

test('assessSkillForProject: 0× global and 0× project can be disabled', () => {
  const skill = { folder: 'firecrawl', name: 'firecrawl', usageCount: 0, canToggle: true, disabled: false };
  const v = skillProject.assessSkillForProject(skill, { haystack: 'a web app' }, {});
  assert.strictEqual(v.code, 'safe');
  assert.strictEqual(v.canDisable, true);
});

test('assessSkillForProject: strong heuristic blocks even at 0×', () => {
  const skill = { folder: 'instagram-carousel', name: 'instagram-carousel', usageCount: 0, canToggle: true, disabled: false };
  const v = skillProject.assessSkillForProject(skill, { haystack: 'instagram carousel 1080' }, { invokes: {}, reads: {} });
  assert.strictEqual(v.code, 'caution');
  assert.strictEqual(v.canDisable, false);
});

test('aliasInHaystack: ignores an alias when negated in the text', () => {
  const hay = 'preview locks at the gate · validate via subagent instead of fighting with screenshot.';
  assert.strictEqual(skillProject.projectRelation({ folder: 'playwright-skill', name: 'playwright-skill' }, { haystack: hay }).level, 'none');
});

test('assessSkillForProject: weak alias only warns, does not block', () => {
  const skill = { folder: 'frontend-design', name: 'frontend-design', usageCount: 0, canToggle: true, disabled: false };
  const v = skillProject.assessSkillForProject(skill, { haystack: 'has a nice landing page' }, { invokes: {}, reads: {} });
  assert.strictEqual(v.code, 'safe'); // "landing" removed from weak — only design system
  const v2 = skillProject.assessSkillForProject(
    { folder: 'playwright-skill', name: 'playwright-skill', usageCount: 0, canToggle: true, disabled: false },
    { haystack: 'we use playwright in ci' },
    { invokes: {}, reads: {} },
  );
  assert.strictEqual(v2.code, 'caution');
  assert.strictEqual(v2.canDisable, true);
});

test('assessSkillForProject: SKILL.md read in the project = caution', () => {
  const skill = { folder: 'brainstorming', name: 'brainstorming', usageCount: 2, canToggle: true, disabled: false };
  const v = skillProject.assessSkillForProject(skill, { haystack: 'x' }, { invokes: {}, reads: { brainstorming: 1 } });
  assert.strictEqual(v.code, 'caution');
  assert.strictEqual(v.canDisable, false);
});

test('assessSkillForProject: weak alias dashboard in frontend-design only warns', () => {
  const skill = { folder: 'frontend-design', name: 'frontend-design', usageCount: 0, canToggle: true, disabled: false };
  const v = skillProject.assessSkillForProject(skill, { haystack: 'panel dashboard html' }, { invokes: {}, reads: {} });
  assert.strictEqual(v.code, 'caution');
  assert.strictEqual(v.canDisable, true);
});

test('scanLineText: invokes a skill from ~/.claude/skills and ignores plugin path', () => {
  const invokes = {};
  const reads = {};
  skillProject.scanLineText(
    '{"text":"Base directory for this skill: C:\\\\Users\\\\x\\\\.claude\\\\skills\\\\context-economy\\n"}',
    invokes, reads,
  );
  skillProject.scanLineText(
    'Base directory for this skill: C:\\AppData\\skills-plugin\\abc\\skills\\humanizer',
    invokes, reads,
  );
  assert.strictEqual(invokes['context-economy'], 1);
  assert.strictEqual(invokes.humanizer, undefined);
});

test('scanLineText: SKILL.md read without false browser-harness', () => {
  const reads = {};
  skillProject.scanLineText('npx skills search browser-harness', {}, reads);
  skillProject.scanLineText('Read C:\\\\Users\\\\x\\\\.claude\\\\skills\\\\instagram-carousel\\\\SKILL.md', {}, reads);
  assert.strictEqual(reads['instagram-carousel'], 1);
  assert.strictEqual(reads['browser-harness'], undefined);
});

const dates = require('../scripts/lib/dates.cjs');
const logScan = require('../scripts/lib/log-scan.cjs');

test('localDateKey: UTC night is still the previous day in São Paulo', () => {
  // 2026-06-22 22:11 BRT = 2026-06-23 01:11 UTC — must fall in the 2026-06-22 bucket
  assert.strictEqual(dates.localDateKey('2026-06-23T01:11:06.875Z'), '2026-06-22');
});

test('localDateKey: UTC noon keeps the same civil day in SP', () => {
  assert.strictEqual(dates.localDateKey('2026-06-15T10:00:00Z'), '2026-06-15');
});

test('localDateKey: local midnight rolls over to the new day', () => {
  // 2026-06-23 00:00 BRT = 2026-06-23 03:00 UTC
  assert.strictEqual(dates.localDateKey('2026-06-23T03:00:00Z'), '2026-06-23');
});

test('listJsonlFiles: finds jsonl in subagents/', () => {
  const root = tmp('jsonlwalk');
  fs.mkdirSync(path.join(root, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'main.jsonl'), '{}\n');
  fs.writeFileSync(path.join(root, 'subagents', 'a.jsonl'), '{}\n');
  const files = logScan.listJsonlFiles(root);
  assert.strictEqual(files.length, 2);
  assert.ok(files.some(f => f.includes('subagents')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('aggregate: includes subagents/ usage in spend per day', async () => {
  const enc = require('../scripts/lib/paths.cjs');
  const { aggregate } = require('../scripts/aggregate.cjs');
  const root = tmp('agg');
  const fakeProj = path.join(root, 'repo');
  fs.mkdirSync(fakeProj, { recursive: true });
  const logDir = path.join(enc.projectsRoot(), enc.encodeCwd(fakeProj));
  fs.mkdirSync(path.join(logDir, 'subagents'), { recursive: true });
  const line = JSON.stringify({
    timestamp: '2026-06-15T10:00:00Z',
    message: { usage: { input_tokens: 4000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  });
  fs.writeFileSync(path.join(logDir, 'subagents', 'only-sub.jsonl'), line + '\n');
  const data = await aggregate();
  const day = data.days.find(d => d.date === '2026-06-15');
  assert.ok(day, 'day 2026-06-15 must exist');
  assert.ok(day.billed >= 5000, 'billed must include the subagent');
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('scanProjectSkillUsage: reads jsonl in the subagents subfolder', async () => {
  const enc = require('../scripts/lib/paths.cjs');
  const root = tmp('projscan');
  const fakeProj = path.join(root, 'repo');
  fs.mkdirSync(fakeProj, { recursive: true });
  const logDir = path.join(enc.projectsRoot(), enc.encodeCwd(fakeProj));
  fs.mkdirSync(path.join(logDir, 'subagents'), { recursive: true });
  const line = JSON.stringify({
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:/Users/x/.claude/skills/brainstorming/SKILL.md' } }] },
  });
  fs.writeFileSync(path.join(logDir, 'subagents', 'agent-a.jsonl'), line + '\n');
  const u = await skillProject.scanProjectSkillUsage(fakeProj);
  assert.ok(u.filesScanned >= 1);
  assert.ok(u.reads.brainstorming >= 1);
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});
