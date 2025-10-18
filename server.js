// server.js
import express from 'express';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

let RAW = [];
loadJSON();

function loadJSON() {
  const text = fs.readFileSync('./events.json', 'utf8');
  const arr = JSON.parse(text);
  RAW = arr.map(normalize);
}

// 可選：監聽檔案變動
fs.watch('./events.json', { persistent: false }, () => {
  try { loadJSON(); console.log('events.json reloaded'); } catch {}
});

function normalize(raw) {
  const v = raw.venue || {};
  const title = raw.title || raw.name || '';
  const desc = raw.desc || raw.description || '';
  const type = raw.type || raw.category || '';
  const start = raw.start_at || raw.start || raw.date || '';
  const end   = raw.end_at || raw.end || '';
  const url   = raw.url || raw.link || '';
  const priceMin = toNum(raw.price_min ?? raw.priceMin ?? raw.price ?? '');
  const priceMax = toNum(raw.price_max ?? raw.priceMax ?? raw.price ?? '');
  const venueName = v.name || raw.venue_name || '';
  const district  = v.district || v.area || raw.district || '';
  const lat = toNum(v.lat ?? v.latitude ?? raw.lat ?? raw.latitude ?? '');
  const lng = toNum(v.lng ?? v.longitude ?? raw.lng ?? raw.longitude ?? '');
  return {
    _raw: raw, title, desc, type, start, end, url,
    priceMin, priceMax, venueName, district, lat, lng,
    _haystack: [title, desc, type, venueName, district, start, end, url]
      .filter(Boolean).join(' ').toLowerCase()
  };
  function toNum(x){ const n = parseFloat(x); return Number.isFinite(n) ? n : null; }
}

// 取唯一清單供前端選單
app.get('/meta', (req, res) => {
  const types = [...new Set(RAW.map(x => x.type).filter(Boolean))].sort();
  const districts = [...new Set(RAW.map(x => x.district).filter(Boolean))].sort();
  res.json({ types, districts });
});

// 主查詢：/events
// 參數：q, type, district, weekday, freeOnly, dateFrom, dateTo, limit, offset
app.get('/events', (req, res) => {
  const {
    q = '', type = '', district = '',
    weekday = '',             // 可傳 0-6 (日=0) 或 zh: 一二三四五六日
    freeOnly = 'false',
    dateFrom = '',            // ISO yyyy-mm-dd
    dateTo = '',              // ISO yyyy-mm-dd
    limit = '200', offset = '0'
  } = req.query;

  const words = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const free = String(freeOnly).toLowerCase() === 'true';
  const wd = parseWeekday(weekday); // -1 表示不指定

  const from = dateFrom ? new Date(dateFrom) : null;
  const to   = dateTo   ? new Date(dateTo)   : null;

  let list = RAW.filter(d => {
    if (type && d.type !== type) return false;
    if (district && d.district !== district) return false;
    if (free && !isFree(d)) return false;
    if (words.length && !words.every(w => d._haystack.includes(w))) return false;

    // 日期區間過濾（若有給）
    if ((from || to) && !overlapsRange(d, from, to)) return false;

    // 星期過濾（若有給）
    if (wd !== -1 && !hitsWeekday(d, wd)) return false;

    return true;
  });

  const off = Math.max(0, parseInt(offset,10) || 0);
  const lim = Math.max(1, Math.min(1000, parseInt(limit,10) || 200));
  const sliced = list.slice(off, off + lim);

  res.json({
    total: list.length,
    offset: off,
    limit: lim,
    results: sliced.map(x => x._raw) // 回傳原始物件
  });
});

function isFree(d){
  if (d.priceMin === 0 || d.priceMax === 0) return true;
  if (d.priceMin == null && d.priceMax == null) return false;
  return false;
}

function overlapsRange(d, from, to){
  const s = d.start ? new Date(d.start) : null;
  const e = d.end   ? new Date(d.end)   : null;
  if (!s && !e) return false;
  const start = s || e;
  const end = e || s;
  if (from && end   && end   < from) return false;
  if (to   && start && start > to)   return false;
  return true;
}

function hitsWeekday(d, wd){
  // 若有區間，檢查任一天是否命中；若只有單日，檢查單日
  const s = d.start ? new Date(d.start) : null;
  const e = d.end   ? new Date(d.end)   : null;
  if (!s && !e) return false;
  let cur = new Date(s || e);
  let last = new Date(e || s);
  // 正規化為 00:00
  cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
  last = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  for (let dt = cur; dt <= last; dt = addDays(dt, 1)) {
    if (dt.getDay() === wd) return true;
  }
  return s ? s.getDay() === wd : false;
}

function addDays(d, n){ const t = new Date(d); t.setDate(t.getDate()+n); return t; }

function parseWeekday(x){
  if (x === '' || x == null) return -1;
  const num = Number(x);
  if (Number.isInteger(num) && num >= 0 && num <= 6) return num;
  const m = String(x).trim();
  // 支援：一二三四五六日/天，或「星期二」「週二」「禮拜二」
  const map = { '日':0, '天':0, '一':1, '二':2, '三':3, '四':4, '五':5, '六':6 };
  const ch = m.replace(/星期|週|禮拜/g,'').slice(-1);
  return map[ch] ?? -1;
}

app.listen(PORT, () => {
  console.log(`Server running http://localhost:${PORT}`);
});
