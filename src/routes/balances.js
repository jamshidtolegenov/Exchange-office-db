const express = require('express');
const { store } = require('../db/store');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const CITIES = ['shymkent', 'almaty', 'moscow', 'tashkent'];
const router  = express.Router();

router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try { res.json(await store.getAllBalances()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:cityId', authMiddleware, async (req, res) => {
  try {
    const { cityId } = req.params;
    if (!CITIES.includes(cityId)) return res.status(404).json({ error: 'Город не найден' });
    if (req.user.role === 'operator' && req.user.city !== cityId)
      return res.status(403).json({ error: 'Доступ запрещён' });
    res.json({ city: cityId, balances: await store.getBalance(cityId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:cityId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { cityId } = req.params;
    if (!CITIES.includes(cityId)) return res.status(404).json({ error: 'Город не найден' });
    const { newValues, comment } = req.body || {};
    if (!newValues || typeof newValues !== 'object')
      return res.status(400).json({ error: 'Передайте newValues' });
    const result = await store.editBalance({ city: cityId, newValues, operator: req.user.login, comment });
    res.json({ balances: await store.getBalance(cityId), logEntries: result.logEntries });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/:cityId/logs', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { cityId } = req.params;
    if (!CITIES.includes(cityId)) return res.status(404).json({ error: 'Город не найден' });
    const { dateFrom, dateTo, limit, offset } = req.query;
    res.json(await store.getBalanceLogs({ city: cityId, dateFrom, dateTo, limit, offset }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/logs/all', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { city, dateFrom, dateTo, limit, offset } = req.query;
    res.json(await store.getBalanceLogs({ city, dateFrom, dateTo, limit, offset }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
