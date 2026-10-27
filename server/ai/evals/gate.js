#!/usr/bin/env node
// Проверка агента перед деплоем — одной командой: автотесты, потом все наборы на
// настоящей модели, каждый сценарий по нескольку раз, и то же на прежней версии
// (по умолчанию origin/main — то, что на проде). Модель отвечает не одинаково:
// сценарий может пройти случайно, поэтому сравниваем, сколько раз из N он прошёл
// до и после. Деплой — только если ни один сценарий не стал проходить реже, а
// новые сценарии проходят каждый раз.
//
// Почему так: 27.10 новый инструмент update_contract прошёл свои проверки, но сдвинул
// выбор модели в старом умении («закрывает со скидкой» → обычный платёж вместо
// early_payoff): до правки 3 из 3, после — 0 из 3. Видно было только при сравнении.
//
//   cd server && npm run ai:gate                    (3 прогона, база origin/main)
//   --runs 1          быстрый прогон
//   --base HEAD~1     другая база;  --no-base — без сравнения (всё должно проходить всегда)
//   --suites actions,skills   только эти наборы (actions, skills, numbers, local)
//   --jobs 4          сколько наборов идёт одновременно
// Нужны локальный PostgreSQL (DATABASE_URL в server/.env) и ключ OpenRouter. Стоимость —
// около доллара за 3 прогона с базой; время — 15–30 минут.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '../..');
const ROOT = path.join(SERVER, '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
};
const RUNS = Math.max(1, Number(arg('runs', 3)) || 3);
const BASE = process.argv.includes('--no-base') ? null : arg('base', 'origin/main');
const JOBS = Math.max(1, Number(arg('jobs', 4)) || 4);

// Наборы и разбор их вывода в «сценарий → прошёл ли»
const SUITES = {
  actions: { file: 'ai/evals/actions-audit.js', parse: marks },
  skills: { file: 'ai/evals/skills-isolated.js', parse: marks },
  numbers: { file: 'ai/evals/numbers-audit.js', parse: numbers },
  local: { file: 'ai/evals/local-isolated.js', parse: localMarks },
};
const wanted = String(arg('suites', Object.keys(SUITES).join(','))).split(',').filter(s => SUITES[s]);

// «✓  8. Досрочно со скидкой 10%: …  6.3 с» — имя без номера: в новой версии номера сдвигаются
function marks(out) {
  const r = {};
  for (const m of out.matchAll(/^([✓✗])\s+\d+\.\s+(.+?)\s{2}[\d.]+ с/gm)) r[m[2]] = m[1] === '✓';
  return r;
}
// «\n 12. Вопрос\n    ок · инструменты: …»
function numbers(out) {
  const r = {};
  for (const m of out.matchAll(/^\s*\d+\.\s+(.+)\n\s+(ок|ВЫДУМАНО|НЕВЕРНО)/gm)) r[m[1]] = m[2] === 'ок';
  return r;
}
// Сценарии со временем и в конце «✓ Новый сценарий: …» без него; не дошёл до них — упал
function localMarks(out, code) {
  const r = marks(out);
  for (const name of ['предварительный расчёт не меняет записи', 'перенос только после подтверждения, вместе с закупом, повтор безопасен']) {
    r[`Новый сценарий: ${name}`] = out.includes(`✓ Новый сценарий: ${name}`);
  }
  return r;
}

const run = (cwd, file) => new Promise(resolve => {
  const started = Date.now();
  const child = spawn(process.execPath, [file], { cwd, env: process.env });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
  child.on('close', code => { clearTimeout(timer); resolve({ out, code, sec: Math.round((Date.now() - started) / 1000) }); });
});

// Очередь: не больше JOBS процессов разом
const pool = (tasks) => new Promise(resolve => {
  const results = new Array(tasks.length);
  let next = 0, done = 0;
  const start = () => {
    if (next >= tasks.length) return;
    const i = next++;
    tasks[i]().then(r => { results[i] = r; done++; if (done === tasks.length) resolve(results); else start(); });
  };
  if (!tasks.length) resolve([]);
  for (let k = 0; k < Math.min(JOBS, tasks.length); k++) start();
});

// Прежняя версия — отдельной папкой рядом (git worktree), с теми же node_modules и .env
const baseTree = (ref) => {
  const sha = execFileSync('git', ['rev-parse', '--short', ref], { cwd: ROOT }).toString().trim();
  const dir = path.join(os.tmpdir(), `finuchet-gate-${sha}`);
  if (!fs.existsSync(dir)) {
    execFileSync('git', ['worktree', 'add', '--detach', dir, ref], { cwd: ROOT, stdio: 'ignore' });
  }
  for (const f of ['node_modules', '.env']) {
    const link = path.join(dir, 'server', f);
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(SERVER, f), link);
  }
  return { sha, dir: path.join(dir, 'server') };
};

(async () => {
  const t0 = Date.now();
  // 1. Автотесты — без модели, быстро; красные — дальше не идём
  console.log('1. Автотесты…');
  const unit = await new Promise(resolve => {
    const files = [...fs.readdirSync(path.join(SERVER, 'ai')).filter(f => f.endsWith('.test.js')).map(f => `server/ai/${f}`),
      ...fs.readdirSync(path.join(SERVER, 'contractTemplates')).filter(f => f.endsWith('.test.js')).map(f => `server/contractTemplates/${f}`)];
    const child = spawn(process.execPath, ['-r', './server/node_modules/dotenv/config', '--test', ...files, 'dotenv_config_path=server/.env'], { cwd: ROOT, env: process.env });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
  const count = (k) => Number((unit.out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
  console.log(`   ${count('pass')} прошли, ${count('fail')} упали`);
  if (unit.code !== 0) {
    console.log(unit.out.split('\n').filter(l => /not ok|AssertionError|Error:|expected|actual/.test(l)).slice(0, 30).join('\n'));
    console.log('\n✗ НЕЛЬЗЯ ДЕПЛОИТЬ: автотесты красные.');
    process.exit(1);
  }

  // 2. Наборы на модели: текущая версия и база, по RUNS раз
  let base = null;
  if (BASE) {
    try { base = baseTree(BASE); } catch (e) { console.log(`База ${BASE} недоступна (${e.message.split('\n')[0]}) — сравнение пропущено.`); }
  }
  console.log(`2. Сценарии на модели: ${wanted.join(', ')} × ${RUNS}${base ? `, база ${BASE} (${base.sha})` : ', без базы'}…`);
  const tasks = [];
  for (let n = 0; n < RUNS; n++) {
    for (const s of wanted) {
      tasks.push(() => run(SERVER, SUITES[s].file).then(r => ({ s, side: 'cur', ...r })));
      if (base && fs.existsSync(path.join(base.dir, SUITES[s].file))) tasks.push(() => run(base.dir, SUITES[s].file).then(r => ({ s, side: 'base', ...r })));
    }
  }
  const results = await pool(tasks.map(t => async () => {
    const r = await t();
    process.stdout.write(`   ${r.side === 'cur' ? 'новая' : 'база '} ${r.s.padEnd(7)} ${r.sec} с${r.code !== 0 && !/прошли|Проблемных/.test(r.out) ? ` — не дошёл до конца: ${r.out.trim().split('\n').pop().slice(0, 160)}` : ''}\n`);
    return r;
  }));

  // сценарий → { cur: [true,false,…], base: […] }
  const table = {};
  for (const r of results) {
    const parsed = SUITES[r.s].parse(r.out, r.code);
    for (const [name, ok] of Object.entries(parsed)) {
      const row = table[`${r.s} · ${name}`] ||= { cur: [], base: [] };
      row[r.side].push(ok);
    }
  }
  const pass = a => a.filter(Boolean).length;
  const regress = [], fresh = [], flaky = [], known = [];
  for (const [name, row] of Object.entries(table)) {
    if (!row.cur.length) continue; // сценарий убран в новой версии
    const c = pass(row.cur), b = pass(row.base);
    const line = `${name}: ${c} из ${row.cur.length}${row.base.length ? ` (было ${b} из ${row.base.length})` : ''}`;
    if (!row.base.length) { if (c < row.cur.length) fresh.push(line); }
    else {
      // Стало реже на треть прогонов и больше (3→1, 3→0) или перестал проходить совсем — провал;
      // одно падение из трёх при прежних 3 из 3 — предупреждение: модель иногда ошибается и без правки
      const drop = b / row.base.length - c / row.cur.length;
      if (drop > 0.34 || (c === 0 && b > 0)) regress.push(line);
      else if (drop > 0) flaky.push(line);
      else if (c < row.cur.length) known.push(line);
    }
  }
  // Набор не отработал ни разу в новой версии — это тоже провал
  const silent = wanted.filter(s => !Object.keys(table).some(k => k.startsWith(`${s} · `) && table[k].cur.length));

  const out = (title, list) => { if (list.length) console.log(`\n${title}\n${list.map(l => `   ${l}`).join('\n')}`); };
  out('✗ Стало хуже, чем до правки:', regress);
  out('✗ Новый сценарий проходит не всегда (без базы — все сценарии):', fresh);
  out('✗ Набор не выдал результатов:', silent);
  out('! Не всегда и раньше — не из-за правки, но стоит посмотреть:', known);
  out('! Чуть реже, чем до правки (в пределах допуска) — прогоните ещё раз, если сомневаетесь:', flaky);
  const total = Object.values(table).filter(r => r.cur.length).length;
  const bad = regress.length + fresh.length + silent.length;
  const report = path.join(os.tmpdir(), 'finuchet-gate-last.json');
  fs.writeFileSync(report, JSON.stringify({ at: new Date().toISOString(), base: base?.sha || null, runs: RUNS, table }, null, 1));
  console.log(`\n${bad ? '✗ НЕЛЬЗЯ ДЕПЛОИТЬ' : '✓ МОЖНО ДЕПЛОИТЬ'}: ${total} сценариев × ${RUNS}, ${Math.round((Date.now() - t0) / 60000)} мин. Подробно: ${report}`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
