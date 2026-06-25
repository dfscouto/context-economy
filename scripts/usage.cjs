#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { resolveLogDir, skillDir } = require('./lib/paths.cjs');
const { k, pct } = require('./lib/billing.cjs');

(async () => {
  const dir = resolveLogDir(process.cwd());
  if (!dir || !fs.existsSync(dir)) {
    console.log('📊 context-economy: no session logs to measure.');
    return;
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  if (!files.length) {
    console.log('📊 context-economy: no sessions in this folder.');
    return;
  }

  let inp = 0, out = 0, cr = 0, cw = 0, sessions = files.length;
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let u;
      try {
        const o = JSON.parse(line);
        u = (o.message && o.message.usage) || o.usage;
      } catch { continue; }
      if (!u) continue;
      inp += u.input_tokens || 0;
      out += u.output_tokens || 0;
      cr += u.cache_read_input_tokens || 0;
      cw += u.cache_creation_input_tokens || 0;
    }
  }

  const billed = inp + out + cw * 1.25 + cr * 0.1;
  if (billed <= 0) {
    console.log('📊 context-economy: nothing measurable yet.');
    return;
  }
  const hist = pct(cr * 0.1 + cw * 1.25, billed);
  const work = pct(inp + out, billed);

  console.log('📊 context-economy — ' + sessions + ' sessions IN THIS PROJECT:');
  console.log('   history re-read: ~' + hist + '% of cost  ·  cache_read ' + k(cr) + ' raw (already with ~90% cache discount)');
  console.log('   new work: ~' + work + '%');
  console.log('   💡 in a long continuous task the cache already makes the re-read cheap — it\'s not waste.');
  console.log('      the /clear win is when SWITCHING tasks: the new session doesn\'t reload this history. Truth lives in the docs.');
  console.log('   📈 dashboard: ' + path.join(skillDir(), 'dashboard', 'index.html'));
  console.log('   🧹 skills/MCP overhead: node ' + path.join(skillDir(), 'scripts', 'list-bloat.cjs'));

  // context profile: what's YOUR pain (image? PDF? log? reading?) — cheap (3 recent
  // files) and shielded: the profile is a bonus, it can never bring down the boot hook.
  try {
    const { listJsonlFiles, isTopLevelSessionFile } = require('./lib/log-scan.cjs');
    const { emptyAcc, scanFiles, summarize } = require('./lib/profile-scan.cjs');
    const recent = listJsonlFiles(dir).filter(f => isTopLevelSessionFile(dir, f)).slice(0, 3);
    if (recent.length) {
      const { dom } = summarize(await scanFiles(recent, emptyAcc()));
      if (dom) {
        console.log('   🧬 your context profile: ' + dom.profile + ' (' + dom.label + ' = ' + dom.pct + '% of content)');
        console.log('      → diagnosis + fix: node ' + path.join(skillDir(), 'scripts', 'context-profile.cjs'));
      }
    }
  } catch { /* profile is a bonus; never brings down the hook */ }
})();
