const express = require('express');
const { store } = require('../db/store');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      const perm = await store.getPermission(req.user.login);
      if (!perm.statsAccess)
        return res.status(403).json({ error: 'Доступ к статистике закрыт администратором' });
      const { dateFrom, dateTo } = req.query;
      return res.json(await store.getStats({ city: req.user.city, dateFrom: dateFrom||undefined, dateTo: dateTo||undefined }));
    }
    const { city, dateFrom, dateTo } = req.query;
    res.json(await store.getStats({ city: city||undefined, dateFrom: dateFrom||undefined, dateTo: dateTo||undefined }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
