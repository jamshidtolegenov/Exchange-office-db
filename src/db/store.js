/**
 * PostgreSQL store — замена JSON-файловой базы данных.
 *
 * Все методы сохраняют тот же публичный интерфейс, что и старый store.js,
 * поэтому все routes/*.js остаются без изменений (кроме добавления await).
 *
 * Переменная окружения DATABASE_URL должна содержать строку подключения
 * к PostgreSQL (Render автоматически устанавливает её для связанных БД).
 */

const { Pool } = require('pg');
const bcrypt    = require('bcryptjs');

// ── Connection pool ───────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

// ── Schema bootstrap ─────────────────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id     SERIAL PRIMARY KEY,
      login  TEXT NOT NULL UNIQUE,
      role   TEXT NOT NULL,
      city   TEXT,
      label  TEXT
    );

    CREATE TABLE IF NOT EXISTS passwords (
      login TEXT PRIMARY KEY,
      hash  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rates (
      currency TEXT PRIMARY KEY,
      buy      NUMERIC NOT NULL,
      sell     NUMERIC NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_logs (
      id       SERIAL PRIMARY KEY,
      iso_date TEXT NOT NULL,
      iso_ts   TEXT NOT NULL,
      time     TEXT NOT NULL,
      operator TEXT NOT NULL,
      changes  JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS balances (
      city     TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount   NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (city, currency)
    );

    CREATE TABLE IF NOT EXISTS balance_logs (
      id       SERIAL PRIMARY KEY,
      iso_date TEXT NOT NULL,
      iso_ts   TEXT NOT NULL,
      time     TEXT NOT NULL,
      city     TEXT NOT NULL,
      operator TEXT NOT NULL,
      comment  TEXT,
      changes  JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operations (
      id          SERIAL PRIMARY KEY,
      iso_date    TEXT NOT NULL,
      iso_ts      TEXT NOT NULL,
      time        TEXT NOT NULL,
      city        TEXT NOT NULL,
      type        TEXT NOT NULL,
      currency    TEXT NOT NULL,
      amount_cur  NUMERIC NOT NULL,
      amount_kzt  NUMERIC NOT NULL,
      rate_buy    NUMERIC,
      rate_sell   NUMERIC,
      rate        NUMERIC,
      spread      NUMERIC,
      profit      NUMERIC,
      operator    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      login        TEXT PRIMARY KEY,
      stats_access BOOLEAN NOT NULL DEFAULT false
    );
  `);

  // ── Seed if empty ─────────────────────────────────────────────────────────
  const { rows: userRows } = await pool.query('SELECT COUNT(*) FROM users');
  if (Number(userRows[0].count) === 0) {
    console.log('🌱 Seeding initial data...');

    const hash = await bcrypt.hash('pass1234', 10);

    const users = [
      { login: 'admin', role: 'admin',    city: null,       label: 'Центральная касса' },
      { login: 'user1', role: 'operator', city: 'shymkent', label: 'Шымкент' },
      { login: 'user2', role: 'operator', city: 'almaty',   label: 'Алматы'  },
      { login: 'user3', role: 'operator', city: 'moscow',   label: 'Москва'  },
      { login: 'user4', role: 'operator', city: 'tashkent', label: 'Ташкент' },
    ];

    for (const u of users) {
      await pool.query(
        'INSERT INTO users (login, role, city, label) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [u.login, u.role, u.city, u.label]
      );
      await pool.query(
        'INSERT INTO passwords (login, hash) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [u.login, hash]
      );
      if (u.role === 'operator') {
        await pool.query(
          'INSERT INTO permissions (login, stats_access) VALUES ($1, false) ON CONFLICT DO NOTHING',
          [u.login]
        );
      }
    }

    const defaultRates = [
      { currency: 'USD', buy: 468,    sell: 472    },
      { currency: 'RUB', buy: 5.07,   sell: 5.13   },
      { currency: 'UZS', buy: 0.0368, sell: 0.0372 },
      { currency: 'EUR', buy: 510,    sell: 515    },
    ];
    for (const r of defaultRates) {
      await pool.query(
        'INSERT INTO rates (currency, buy, sell) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [r.currency, r.buy, r.sell]
      );
    }

    const defaultBalances = [
      { city: 'shymkent', KZT: 1000000, USD: 500, RUB: 300, UZS: 0,       EUR: 200 },
      { city: 'almaty',   KZT: 800000,  USD: 400, RUB: 250, UZS: 0,       EUR: 150 },
      { city: 'moscow',   KZT: 500000,  USD: 200, RUB: 700, UZS: 0,       EUR: 100 },
      { city: 'tashkent', KZT: 300000,  USD: 100, RUB: 50,  UZS: 5000000, EUR: 50  },
    ];
    for (const b of defaultBalances) {
      for (const [cur, amt] of Object.entries(b)) {
        if (cur === 'city') continue;
        await pool.query(
          'INSERT INTO balances (city, currency, amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [b.city, cur, amt]
        );
      }
    }

    console.log('✅ Seed complete.');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const round  = v => Math.round(v * 100) / 100;
const round6 = v => Math.round(v * 1e6) / 1e6;

function nowLabels() {
  const now = new Date();
  return {
    isoDate: now.toISOString().slice(0, 10),
    isoTs:   now.toISOString(),
    time:    now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
           + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
}

// ── store ─────────────────────────────────────────────────────────────────────
const store = {

  // ── users ──────────────────────────────────────────────────────────────────
  async findUser(login) {
    const { rows } = await pool.query('SELECT * FROM users WHERE login=$1', [login]);
    return rows[0] || null;
  },
  async getOperators() {
    const { rows } = await pool.query("SELECT * FROM users WHERE role='operator'");
    return rows;
  },
  async getPasswordHash(login) {
    const { rows } = await pool.query('SELECT hash FROM passwords WHERE login=$1', [login]);
    return rows[0]?.hash || null;
  },

  // ── permissions ────────────────────────────────────────────────────────────
  async getPermissions() {
    const { rows } = await pool.query('SELECT login, stats_access FROM permissions');
    const out = {};
    for (const r of rows) out[r.login] = { statsAccess: r.stats_access };
    return out;
  },
  async getPermission(login) {
    const { rows } = await pool.query('SELECT stats_access FROM permissions WHERE login=$1', [login]);
    return rows[0] ? { statsAccess: rows[0].stats_access } : { statsAccess: false };
  },
  async setPermission(login, perms) {
    await pool.query(
      `INSERT INTO permissions (login, stats_access) VALUES ($1,$2)
       ON CONFLICT (login) DO UPDATE SET stats_access=EXCLUDED.stats_access`,
      [login, perms.statsAccess ?? false]
    );
    return this.getPermission(login);
  },

  // ── rates ──────────────────────────────────────────────────────────────────
  async getRates() {
    const { rows } = await pool.query('SELECT currency, buy, sell FROM rates');
    const out = {};
    for (const r of rows) out[r.currency] = { buy: Number(r.buy), sell: Number(r.sell) };
    return out;
  },

  async setRates(newRates, operator) {
    const { isoDate, isoTs, time } = nowLabels();
    const changes = [];
    const current = await this.getRates();

    for (const [cur, val] of Object.entries(newRates)) {
      if (!val || typeof val !== 'object') continue;
      const { buy, sell } = val;
      if (typeof buy !== 'number' || typeof sell !== 'number') continue;
      if (buy <= 0 || sell <= 0 || buy > sell) continue;
      const old = current[cur] || {};
      if (old.buy !== buy || old.sell !== sell) {
        changes.push({ currency: cur, oldBuy: old.buy, oldSell: old.sell, newBuy: buy, newSell: sell });
        await pool.query(
          `INSERT INTO rates (currency, buy, sell) VALUES ($1,$2,$3)
           ON CONFLICT (currency) DO UPDATE SET buy=EXCLUDED.buy, sell=EXCLUDED.sell`,
          [cur, buy, sell]
        );
      }
    }

    if (changes.length > 0) {
      await pool.query(
        'INSERT INTO rate_logs (iso_date, iso_ts, time, operator, changes) VALUES ($1,$2,$3,$4,$5)',
        [isoDate, isoTs, time, operator || 'admin', JSON.stringify(changes)]
      );
    }
    return this.getRates();
  },

  async getRateLogs({ dateFrom, dateTo, limit = 100, offset = 0 } = {}) {
    let q = 'SELECT * FROM rate_logs WHERE 1=1';
    const params = [];
    if (dateFrom) { params.push(dateFrom); q += ` AND iso_date >= $${params.length}`; }
    if (dateTo)   { params.push(dateTo);   q += ` AND iso_date <= $${params.length}`; }
    q += ` ORDER BY id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(limit), Number(offset));
    const { rows } = await pool.query(q, params);
    return rows.map(r => ({
      id: r.id, isoDate: r.iso_date, isoTs: r.iso_ts, time: r.time,
      operator: r.operator, changes: r.changes,
    }));
  },

  // ── balances ───────────────────────────────────────────────────────────────
  async getBalance(city) {
    const { rows } = await pool.query('SELECT currency, amount FROM balances WHERE city=$1', [city]);
    if (!rows.length) return null;
    const out = {};
    for (const r of rows) out[r.currency] = Number(r.amount);
    return out;
  },
  async getAllBalances() {
    const { rows } = await pool.query('SELECT city, currency, amount FROM balances ORDER BY city');
    const out = {};
    for (const r of rows) {
      if (!out[r.city]) out[r.city] = {};
      out[r.city][r.currency] = Number(r.amount);
    }
    return out;
  },

  async editBalance({ city, newValues, operator, comment }) {
    const bal = await this.getBalance(city);
    if (!bal) throw new Error('Город не найден');
    const { isoDate, isoTs, time } = nowLabels();
    const changes = [];

    for (const [currency, newVal] of Object.entries(newValues)) {
      if (!['KZT','USD','RUB','UZS','EUR'].includes(currency)) continue;
      const parsed = Number(newVal);
      if (isNaN(parsed) || parsed < 0) throw new Error(`Некорректное значение для ${currency}`);
      const oldVal = bal[currency] ?? 0;
      if (parsed === oldVal) continue;
      const newRounded = round6(parsed);
      await pool.query(
        `INSERT INTO balances (city, currency, amount) VALUES ($1,$2,$3)
         ON CONFLICT (city, currency) DO UPDATE SET amount=EXCLUDED.amount`,
        [city, currency, newRounded]
      );
      changes.push({ currency, oldVal, newVal: newRounded });
    }

    if (changes.length === 0) return { logEntries: [] };

    const { rows } = await pool.query(
      `INSERT INTO balance_logs (iso_date, iso_ts, time, city, operator, comment, changes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [isoDate, isoTs, time, city, operator, comment || '', JSON.stringify(changes)]
    );
    return { logEntries: [{ id: rows[0].id, isoDate, isoTs, time, city, operator, comment: comment||'', changes }] };
  },

  async getBalanceLogs({ city, dateFrom, dateTo, limit = 100, offset = 0 } = {}) {
    let q = 'SELECT * FROM balance_logs WHERE 1=1';
    const params = [];
    if (city)     { params.push(city);     q += ` AND city = $${params.length}`; }
    if (dateFrom) { params.push(dateFrom); q += ` AND iso_date >= $${params.length}`; }
    if (dateTo)   { params.push(dateTo);   q += ` AND iso_date <= $${params.length}`; }
    q += ` ORDER BY id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(limit), Number(offset));
    const { rows } = await pool.query(q, params);
    return rows.map(r => ({
      id: r.id, isoDate: r.iso_date, isoTs: r.iso_ts, time: r.time,
      city: r.city, operator: r.operator, comment: r.comment, changes: r.changes,
    }));
  },

  // ── operations ─────────────────────────────────────────────────────────────
  async doExchange({ city, opType, currency, amount, operator }) {
    const rates = await this.getRates();
    const rateObj = rates[currency];
    if (!rateObj) throw new Error('Курс не найден');

    const rateValue = opType === 'sell' ? rateObj.sell : rateObj.buy;
    const kzt = amount * rateValue;

    const bal = await this.getBalance(city);
    if (!bal) throw new Error('Город не найден');

    if (opType === 'sell') {
      if ((bal[currency] ?? 0) < amount)
        throw new Error(`Недостаточно ${currency}: в кассе ${(bal[currency]||0).toLocaleString('ru-RU')}`);
      await pool.query(
        `INSERT INTO balances (city, currency, amount) VALUES ($1,$2,$3)
         ON CONFLICT (city, currency) DO UPDATE SET amount=EXCLUDED.amount`,
        [city, currency, round6((bal[currency] || 0) - amount)]
      );
      await pool.query(
        `INSERT INTO balances (city, currency, amount) VALUES ($1,'KZT',$2)
         ON CONFLICT (city, currency) DO UPDATE SET amount=EXCLUDED.amount`,
        [city, round(bal.KZT + kzt)]
      );
    } else {
      if ((bal.KZT ?? 0) < kzt)
        throw new Error(`Недостаточно KZT: в кассе ${(bal.KZT||0).toLocaleString('ru-RU')}`);
      await pool.query(
        `INSERT INTO balances (city, currency, amount) VALUES ($1,'KZT',$2)
         ON CONFLICT (city, currency) DO UPDATE SET amount=EXCLUDED.amount`,
        [city, round(bal.KZT - kzt)]
      );
      await pool.query(
        `INSERT INTO balances (city, currency, amount) VALUES ($1,$2,$3)
         ON CONFLICT (city, currency) DO UPDATE SET amount=EXCLUDED.amount`,
        [city, currency, round6((bal[currency] || 0) + amount)]
      );
    }

    const { isoDate, isoTs, time } = nowLabels();
    const spread = rateObj.sell - rateObj.buy;
    const profit = Math.round(spread * amount * 100) / 100;

    const { rows } = await pool.query(
      `INSERT INTO operations
         (iso_date, iso_ts, time, city, type, currency,
          amount_cur, amount_kzt, rate_buy, rate_sell, rate, spread, profit, operator)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [isoDate, isoTs, time, city, opType, currency,
       amount, kzt, rateObj.buy, rateObj.sell, rateValue, spread, profit, operator]
    );

    return {
      id: rows[0].id, isoDate, isoTs, time,
      city, type: opType, currency,
      amountCur: amount, amountKZT: kzt,
      rateBuy: rateObj.buy, rateSell: rateObj.sell,
      rate: rateValue, spread, profit, operator,
    };
  },

  async getOperations({ city, dateFrom, dateTo, limit = 500, offset = 0 } = {}) {
    let q = 'SELECT * FROM operations WHERE 1=1';
    const params = [];
    if (city && city !== 'all') { params.push(city);     q += ` AND city = $${params.length}`; }
    if (dateFrom)               { params.push(dateFrom); q += ` AND iso_date >= $${params.length}`; }
    if (dateTo)                 { params.push(dateTo);   q += ` AND iso_date <= $${params.length}`; }
    q += ` ORDER BY id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(limit), Number(offset));
    const { rows } = await pool.query(q, params);
    return rows.map(r => ({
      id: r.id, isoDate: r.iso_date, isoTs: r.iso_ts, time: r.time,
      city: r.city, type: r.type, currency: r.currency,
      amountCur: Number(r.amount_cur), amountKZT: Number(r.amount_kzt),
      rateBuy: Number(r.rate_buy), rateSell: Number(r.rate_sell),
      rate: Number(r.rate), spread: Number(r.spread), profit: Number(r.profit),
      operator: r.operator,
    }));
  },

  // ── stats ──────────────────────────────────────────────────────────────────
  async getStats({ city, dateFrom, dateTo } = {}) {
    let q = 'SELECT * FROM operations WHERE 1=1';
    const params = [];
    if (city && city !== 'all') { params.push(city);     q += ` AND city = $${params.length}`; }
    if (dateFrom)               { params.push(dateFrom); q += ` AND iso_date >= $${params.length}`; }
    if (dateTo)                 { params.push(dateTo);   q += ` AND iso_date <= $${params.length}`; }
    const { rows } = await pool.query(q, params);

    const ops = rows.map(r => ({
      city: r.city, type: r.type, currency: r.currency,
      amountKZT: Number(r.amount_kzt), amountCur: Number(r.amount_cur),
      rateBuy: Number(r.rate_buy), rateSell: Number(r.rate_sell),
      isoDate: r.iso_date, profit: Number(r.profit) || 0,
    }));

    const r2 = v => Math.round(v * 100) / 100;
    const totalCount  = ops.length;
    const totalVolume = r2(ops.reduce((s, o) => s + o.amountKZT, 0));
    const totalProfit = r2(ops.reduce((s, o) => s + (o.profit || 0), 0));

    const byType = {
      buy:  { count: 0, volumeKZT: 0, profit: 0 },
      sell: { count: 0, volumeKZT: 0, profit: 0 },
    };
    const byCurrency = {}, rateStats = {}, byCity = {}, byDay = {}, byMonth = {};

    for (const op of ops) {
      const profit = op.profit || 0;
      byType[op.type].count++;
      byType[op.type].volumeKZT += op.amountKZT;
      byType[op.type].profit    += profit;

      if (!byCurrency[op.currency])
        byCurrency[op.currency] = { count: 0, volumeKZT: 0, volumeCur: 0, profit: 0 };
      byCurrency[op.currency].count++;
      byCurrency[op.currency].volumeKZT += op.amountKZT;
      byCurrency[op.currency].volumeCur  += op.amountCur;
      byCurrency[op.currency].profit     += profit;

      if (!rateStats[op.currency])
        rateStats[op.currency] = { minBuy: Infinity, maxBuy: -Infinity, sumBuy: 0, buyCount: 0,
          minSell: Infinity, maxSell: -Infinity, sumSell: 0, sellCount: 0 };
      const rs = rateStats[op.currency];
      if (op.rateBuy  != null) { rs.minBuy  = Math.min(rs.minBuy, op.rateBuy);   rs.maxBuy  = Math.max(rs.maxBuy,  op.rateBuy);  rs.sumBuy  += op.rateBuy;  rs.buyCount++;  }
      if (op.rateSell != null) { rs.minSell = Math.min(rs.minSell, op.rateSell); rs.maxSell = Math.max(rs.maxSell, op.rateSell); rs.sumSell += op.rateSell; rs.sellCount++; }

      if (!byCity[op.city])
        byCity[op.city] = { count: 0, volumeKZT: 0, profit: 0, buyKZT: 0, sellKZT: 0, buyProfit: 0, sellProfit: 0, byCurrency: {} };
      byCity[op.city].count++;
      byCity[op.city].volumeKZT += op.amountKZT;
      byCity[op.city].profit    += profit;
      if (op.type === 'buy')  { byCity[op.city].buyKZT  += op.amountKZT; byCity[op.city].buyProfit  += profit; }
      if (op.type === 'sell') { byCity[op.city].sellKZT += op.amountKZT; byCity[op.city].sellProfit += profit; }
      if (!byCity[op.city].byCurrency[op.currency])
        byCity[op.city].byCurrency[op.currency] = { count: 0, volumeKZT: 0, profit: 0 };
      byCity[op.city].byCurrency[op.currency].count++;
      byCity[op.city].byCurrency[op.currency].volumeKZT += op.amountKZT;
      byCity[op.city].byCurrency[op.currency].profit    += profit;

      const day = op.isoDate, month = op.isoDate.slice(0, 7);
      if (!byDay[day])     byDay[day]     = { count: 0, volumeKZT: 0, profit: 0, byCity: {} };
      if (!byMonth[month]) byMonth[month] = { count: 0, volumeKZT: 0, profit: 0, byCity: {} };
      byDay[day].count++;     byDay[day].volumeKZT     += op.amountKZT; byDay[day].profit     += profit;
      byMonth[month].count++; byMonth[month].volumeKZT += op.amountKZT; byMonth[month].profit += profit;
      if (!byDay[day].byCity[op.city])     byDay[day].byCity[op.city]     = { count: 0, profit: 0 };
      if (!byMonth[month].byCity[op.city]) byMonth[month].byCity[op.city] = { count: 0, profit: 0 };
      byDay[day].byCity[op.city].count++;     byDay[day].byCity[op.city].profit     += profit;
      byMonth[month].byCity[op.city].count++; byMonth[month].byCity[op.city].profit += profit;
    }

    const rObj = obj => {
      const res = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'object' || v === null) { res[k] = v; continue; }
        const rounded = { ...v };
        for (const field of ['volumeKZT','volumeCur','profit','buyKZT','sellKZT','buyProfit','sellProfit']) {
          if (rounded[field] !== undefined) rounded[field] = r2(rounded[field]);
        }
        if (rounded.byCurrency) rounded.byCurrency = rObj(rounded.byCurrency);
        if (rounded.byCity)     rounded.byCity     = rObj(rounded.byCity);
        res[k] = rounded;
      }
      return res;
    };

    const rateStatsF = {};
    for (const [cur, rs] of Object.entries(rateStats)) {
      rateStatsF[cur] = {
        minBuy:  rs.buyCount  ? r2(rs.minBuy)                : null,
        maxBuy:  rs.buyCount  ? r2(rs.maxBuy)                : null,
        avgBuy:  rs.buyCount  ? r2(rs.sumBuy / rs.buyCount)  : null,
        minSell: rs.sellCount ? r2(rs.minSell)               : null,
        maxSell: rs.sellCount ? r2(rs.maxSell)               : null,
        avgSell: rs.sellCount ? r2(rs.sumSell / rs.sellCount): null,
      };
    }

    const byCityR = rObj(byCity);
    const cityEntries = Object.entries(byCityR).sort((a,b) => b[1].profit - a[1].profit);
    const topCity     = cityEntries[0] ? { city: cityEntries[0][0], ...cityEntries[0][1] } : null;
    const dayEntries  = Object.entries(rObj(byDay)).sort((a,b) => b[1].profit - a[1].profit);
    const topDay      = dayEntries[0] ? { date: dayEntries[0][0], ...dayEntries[0][1] } : null;
    const topVolCity  = Object.entries(byCityR).sort((a,b) => b[1].volumeKZT - a[1].volumeKZT)[0];

    return {
      totalCount, totalVolume, totalProfit,
      avgVolume: totalCount ? r2(totalVolume / totalCount) : 0,
      avgProfit: totalCount ? r2(totalProfit / totalCount) : 0,
      byType: {
        buy:  { ...byType.buy,  volumeKZT: r2(byType.buy.volumeKZT),  profit: r2(byType.buy.profit)  },
        sell: { ...byType.sell, volumeKZT: r2(byType.sell.volumeKZT), profit: r2(byType.sell.profit) },
      },
      byCurrency: rObj(byCurrency),
      byCity: byCityR,
      byDay:  rObj(byDay),
      byMonth: rObj(byMonth),
      topCity, topDay,
      topVolCity: topVolCity ? { city: topVolCity[0], ...topVolCity[1] } : null,
      rateStats: rateStatsF,
    };
  },
};

module.exports = { store, initSchema, pool };
