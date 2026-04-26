const express = require('express');
const { store } = require('../db/store');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router  = express.Router();
const FOREIGN = ['USD','RUB','UZS','EUR'];

router.get('/', authMiddleware, async (req, res) => {
  try { res.json(await store.getRates()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    const errors = [];
    for (const cur of FOREIGN) {
      const val = body[cur];
      if (!val) continue;
      const { buy, sell } = val;
      if (typeof buy !== 'number'  || buy  <= 0) { errors.push(`${cur}: buy должен быть > 0`);  continue; }
      if (typeof sell !== 'number' || sell <= 0) { errors.push(`${cur}: sell должен быть > 0`); continue; }
      if (buy > sell) errors.push(`${cur}: курс покупки не может быть выше курса продажи`);
    }
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    res.json(await store.setRates(body, req.user.login));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/logs', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { dateFrom, dateTo, limit, offset } = req.query;
    res.json(await store.getRateLogs({ dateFrom, dateTo, limit, offset }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
