'use strict';
/* Мінімальний читач .xls (BIFF8 у контейнері CFB/OLE2) без залежностей.
   readXls(buf) → [{ name, rows: string[][] }]: усі клітинки текстом (числа — як String(n)), порожні — ''.
   Підтримано: CFB (DIFAT, FAT, міні-потік), BOUNDSHEET, SST + CONTINUE (продовження рядка починається з нового байта
   опцій), LABELSST, LABEL, NUMBER, RK, MULRK. Формули, формати й стилі не потрібні — ігноруються. */
const BAD = () => { const e = new Error('Це не файл .xls з BM300'); e.status = 400; return e; };
const SIG = Buffer.from('D0CF11E0A1B11AE1', 'hex');
const ENDOFCHAIN = 0xFFFFFFFE;

/* ---------- CFB ---------- */
function readCfb(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 1536 || !buf.subarray(0, 8).equals(SIG)) throw BAD();
  const ssz = 1 << buf.readUInt16LE(0x1E), mssz = 1 << buf.readUInt16LE(0x20);
  if (ssz !== 512 && ssz !== 4096) throw BAD();
  const nSect = Math.floor(buf.length / ssz) - 1;
  const sect = i => {
    const o = (i + 1) * ssz;
    if (i < 0 || o >= buf.length) throw BAD();
    return buf.subarray(o, Math.min(o + ssz, buf.length));
  };
  // DIFAT: 109 записів у заголовку + додаткові сектори
  const fatSects = [];
  for (let i = 0; i < 109; i++) { const s = buf.readUInt32LE(0x4C + i * 4); if (s < 0xFFFFFFFA) fatSects.push(s); }
  let dif = buf.readUInt32LE(0x44), guard = 0;
  while (dif < 0xFFFFFFFA && guard++ < 100000) {
    if (dif > nSect) throw BAD();
    const d = sect(dif);
    for (let i = 0; i < ssz / 4 - 1; i++) { const s = d.readUInt32LE(i * 4); if (s < 0xFFFFFFFA) fatSects.push(s); }
    dif = d.readUInt32LE(ssz - 4);
  }
  const fat = new Uint32Array(fatSects.length * ssz / 4);
  fatSects.forEach((s, k) => {
    if (s > nSect) throw BAD();
    const d = sect(s);
    for (let i = 0; i < ssz / 4; i++) fat[k * ssz / 4 + i] = d.readUInt32LE(i * 4);
  });
  const chain = (start, table) => {
    const out = []; let s = start;
    while (s < 0xFFFFFFFA) {
      if (s >= table.length || out.length > table.length) throw BAD();
      out.push(s); s = table[s];
    }
    return out;
  };
  const readChain = (start, size) => {
    const parts = chain(start, fat).map(sect);
    const all = Buffer.concat(parts);
    return size == null ? all : all.subarray(0, size);
  };
  // каталог
  const dir = readChain(buf.readUInt32LE(0x30));
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = dir.readUInt16LE(o + 0x40);
    const type = dir[o + 0x42];
    if (!type || nl < 2 || nl > 64) continue;
    entries.push({ name: dir.toString('utf16le', o, o + nl - 2), type, start: dir.readUInt32LE(o + 0x74), size: dir.readUInt32LE(o + 0x78) });
  }
  const root = entries.find(e => e.type === 5);
  const want = entries.find(e => e.type === 2 && (e.name === 'Workbook' || e.name === 'Book'));
  if (!want) throw BAD();
  if (want.size >= buf.readUInt32LE(0x38) || !root) return readChain(want.start, want.size);
  // міні-потік
  const mini = readChain(root.start, root.size);
  const mfatRaw = readChain(buf.readUInt32LE(0x3C));
  const mfat = new Uint32Array(Math.floor(mfatRaw.length / 4));
  for (let i = 0; i < mfat.length; i++) mfat[i] = mfatRaw.readUInt32LE(i * 4);
  const parts = chain(want.start, mfat).map(s => mini.subarray(s * mssz, (s + 1) * mssz));
  return Buffer.concat(parts).subarray(0, want.size);
}

/* ---------- BIFF8 ---------- */
function records(wb, from) {
  const out = [];
  let o = from, depth = 0;
  while (o + 4 <= wb.length) {
    const type = wb.readUInt16LE(o), len = wb.readUInt16LE(o + 2);
    const data = wb.subarray(o + 4, o + 4 + len);
    out.push({ type, data, pos: o });
    o += 4 + len;
    if (type === 0x809) depth++;
    else if (type === 0x0A && --depth <= 0) break;
  }
  return out;
}

// SST: chunks — тіло SST і всіх CONTINUE одразу за ним
function parseSst(chunks) {
  const strs = [];
  if (!chunks.length || chunks[0].length < 8) return strs;
  const total = chunks[0].readUInt32LE(4);
  let ci = 0, pos = 8;
  const cur = () => chunks[ci];
  const next = () => { ci++; pos = 0; if (ci >= chunks.length) throw BAD(); };
  const u8 = () => { if (pos >= cur().length) next(); return cur()[pos++]; };
  const u16 = () => { const a = u8(); return a | (u8() << 8); };
  const u32 = () => { const a = u16(); return (a + u16() * 65536) >>> 0; };
  const skip = n => {
    while (n > 0) {
      if (pos >= cur().length) next();
      const k = Math.min(n, cur().length - pos); pos += k; n -= k;
    }
  };
  try {
    for (let n = 0; n < total && ci < chunks.length; n++) {
      if (ci === chunks.length - 1 && pos >= cur().length) break;
      const cch = u16(), fl = u8();
      let hi = fl & 1;
      const runs = fl & 8 ? u16() : 0;
      const ext = fl & 4 ? u32() : 0;
      let s = '', rem = cch;
      while (rem > 0) {
        if (pos >= cur().length) { next(); hi = cur()[pos++] & 1; }
        const w = hi ? 2 : 1;
        const k = Math.min(rem, Math.floor((cur().length - pos) / w));
        if (k <= 0) { // непарний залишок байтів — захист від зациклення
          pos = cur().length; continue;
        }
        s += cur().toString(hi ? 'utf16le' : 'latin1', pos, pos + k * w);
        pos += k * w; rem -= k;
      }
      skip(runs * 4 + ext);
      strs.push(s);
    }
  } catch (e) { if (e.status) throw e; }
  return strs;
}

function rk(v) {
  let n;
  if (v & 2) n = v >> 2; // знакове ціле
  else {
    const b = Buffer.alloc(8); b.writeUInt32LE((v & 0xFFFFFFFC) >>> 0, 4);
    n = b.readDoubleLE(0);
  }
  return v & 1 ? n / 100 : n;
}
const numStr = n => String(Math.round(n * 1e9) / 1e9);

function readXls(buf) {
  const wb = readCfb(buf);
  const recs = records(wb, 0);
  if (!recs.length || recs[0].type !== 0x809) throw BAD();
  const sheets = [];
  const sstChunks = [];
  let inSst = false;
  for (const r of recs) {
    if (r.type === 0x85 && r.data.length >= 8) {
      const d = r.data, cch = d[6], fl = d[7];
      const name = fl & 1 ? d.toString('utf16le', 8, 8 + cch * 2) : d.toString('latin1', 8, 8 + cch);
      sheets.push({ name, off: d.readUInt32LE(0), kind: d[5] });
    }
    if (r.type === 0xFC) { inSst = true; sstChunks.push(r.data); }
    else if (r.type === 0x3C && inSst) sstChunks.push(r.data);
    else inSst = false;
  }
  const sst = parseSst(sstChunks);
  return sheets.filter(s => s.kind === 0).map(s => {
    const cells = [];
    let maxC = 0;
    const put = (row, col, v) => {
      if (row > 65535 || col > 255) return;
      (cells[row] || (cells[row] = []))[col] = v;
      if (col + 1 > maxC) maxC = col + 1;
    };
    for (const r of records(wb, s.off)) {
      const d = r.data;
      if (r.type === 0xFD && d.length >= 10) put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
      else if (r.type === 0x204 && d.length >= 9) {
        const cch = d.readUInt16LE(6), hi = d[8] & 1;
        put(d.readUInt16LE(0), d.readUInt16LE(2), hi ? d.toString('utf16le', 9, 9 + cch * 2) : d.toString('latin1', 9, 9 + cch));
      } else if (r.type === 0x203 && d.length >= 14) put(d.readUInt16LE(0), d.readUInt16LE(2), numStr(d.readDoubleLE(6)));
      else if (r.type === 0x27E && d.length >= 10) put(d.readUInt16LE(0), d.readUInt16LE(2), numStr(rk(d.readUInt32LE(6))));
      else if (r.type === 0xBD && d.length >= 6) {
        const row = d.readUInt16LE(0), c0 = d.readUInt16LE(2), n = Math.floor((d.length - 6) / 6);
        for (let i = 0; i < n; i++) put(row, c0 + i, numStr(rk(d.readUInt32LE(4 + i * 6 + 2))));
      }
    }
    const rows = [];
    for (let i = 0; i < cells.length; i++) {
      const src = cells[i] || [], row = new Array(maxC);
      for (let c = 0; c < maxC; c++) row[c] = src[c] ?? '';
      rows.push(row);
    }
    return { name: s.name, rows };
  });
}

module.exports = { readXls };
