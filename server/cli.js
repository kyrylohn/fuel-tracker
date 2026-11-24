'use strict';
// Службові команди всередині контейнера: docker exec fuel fuel user add olena "Олена"
const fs = require('node:fs');
const crypto = require('node:crypto');

const HELP = `Бак: службові команди

  user list                       список користувачів
  user add <логін> "<Ім'я>"       додати; пароль згенерується і з'явиться один раз
                                  (пароль зі stdin: echo ... | fuel user add ... --stdin)
  user passwd <логін> [--stdin]   новий пароль (усі сесії користувача завершаться)
                                  безпечніше з --stdin: без --stdin пароль друкується у вивід
  user del <логін>                видалити

  backup <файл.sqlite>            узгоджена копія бази (VACUUM INTO)
  import-fuelio <файл.csv>        імпорт CSV-копії Fuelio (дублікати пропускаються)
  bm300 <файл.xls...>             імпорт місячних звітів BM300 Pro (повторний імпорт нічого не дублює)
`;

const genPassword = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) { s += abc[b[i] % abc.length]; if (i % 5 === 4 && i < 19) s += '-'; }
  return s;
};

function main(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const [cmd, sub, ...rest] = argv.filter(a => !a.startsWith('--'));
  if (!cmd || cmd === 'help') { process.stdout.write(HELP); return; }
  const D = require('./db');
  const pw = () => flags.has('--stdin') ? fs.readFileSync(0, 'utf8').split(/\r?\n/)[0] : genPassword();

  if (cmd === 'user' && sub === 'list') { D.listUsers().forEach(u => console.log(`${u.login}\t${u.name}`)); return; }
  if (cmd === 'user' && sub === 'add') {
    const p = pw();
    D.addUser({ login: rest[0], name: rest[1] || rest[0], password: p });
    console.log(flags.has('--stdin') ? 'Готово' : `Пароль для ${rest[0]}: ${p}`);
    return;
  }
  if (cmd === 'user' && sub === 'passwd') {
    const p = pw();
    D.setPassword(rest[0], p);
    console.log(flags.has('--stdin') ? 'Готово' : `Новий пароль для ${rest[0]}: ${p}`);
    return;
  }
  if (cmd === 'user' && sub === 'del') { console.log(D.deleteUser(rest[0]) ? 'Видалено' : 'Немає такого'); return; }
  if (cmd === 'backup') { D.backupTo(sub); console.log('Копія: ' + sub); return; }
  if (cmd === 'import-fuelio') {
    const parsed = require('./fuelio').parseFuelio(fs.readFileSync(sub, 'utf8'));
    console.log(D.importFuelio(parsed, { budget: flags.has('--budget') }, null));
    return;
  }
  if (cmd === 'bm300') {
    const files = [sub, ...rest].filter(Boolean);
    if (!files.length) { process.stdout.write(HELP); process.exitCode = 1; return; }
    const { parseBm300 } = require('./bm300');
    for (const f of files) {
      const r = D.importBm300(parseBm300(fs.readFileSync(f)), {}, null);
      console.log(`${require('node:path').basename(f)}: ${r.from || '—'} … ${r.to || '—'}; виміри ${r.samples.new}/${r.samples.total}, пуски ${r.cranks.new}/${r.cranks.total}, зарядка ${r.charges.new}/${r.charges.total}, поїздки ${r.trips.new}/${r.trips.total} (нових/усього)`);
    }
    return;
  }
  process.stdout.write(HELP);
  process.exitCode = 1;
}

try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
