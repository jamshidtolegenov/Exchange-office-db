const express = require('express');
const { store } = require('../db/store');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const CITIES     = ['shymkent','almaty','moscow','tashkent'];
const CURRENCIES = ['USD','RUB','UZS','EUR'];
const router     = express.Router();

router.post('/exchange', authMiddleware, async (req, res) => {
  try {
    const { city, opType, currency, amount } = req.body || {};
    if (!CITIES.includes(city))           return res.status(400).json({ error: 'Неверный город' });
    if (!CURRENCIES.includes(currency))   return res.status(400).json({ error: 'Неверная валюта' });
    if (!['buy','sell'].includes(opType)) return res.status(400).json({ error: 'Неверный тип операции' });
    if (typeof amount !== 'number' || amount <= 0)
      return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
    if (req.user.role === 'operator' && req.user.city !== city)
      return res.status(403).json({ error: 'Нельзя проводить операции в чужом пункте' });
    const operation = await store.doExchange({ city, opType, currency, amount, operator: req.user.login });
    res.json({ ok: true, operation });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { city, dateFrom, dateTo, limit, offset } = req.query;
    res.json(await store.getOperations({ city: city||undefined, dateFrom: dateFrom||undefined, dateTo: dateTo||undefined, limit, offset }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:cityId', authMiddleware, async (req, res) => {
  try {
    const { cityId } = req.params;
    if (!CITIES.includes(cityId)) return res.status(404).json({ error: 'Город не найден' });
    if (req.user.role === 'operator' && req.user.city !== cityId)
      return res.status(403).json({ error: 'Доступ запрещён' });
    const { dateFrom, dateTo, limit, offset } = req.query;
    res.json(await store.getOperations({ city:cityId, dateFrom:dateFrom||undefined, dateTo:dateTo||undefined, limit, offset }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
