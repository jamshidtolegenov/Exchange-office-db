const express = require('express');
const { store } = require('../db/store');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/permissions', authMiddleware, adminOnly, async (req, res) => {
  try {
    const operators = await store.getOperators();
    const perms     = await store.getPermissions();
    res.json(operators.map(u => ({
      login:       u.login,
      label:       u.label,
      city:        u.city,
      statsAccess: perms[u.login]?.statsAccess ?? false,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/permissions/:login', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { login } = req.params;
    const user = await store.findUser(login);
    if (!user || user.role !== 'operator')
      return res.status(404).json({ error: 'Оператор не найден' });
    const { statsAccess } = req.body || {};
    if (typeof statsAccess !== 'boolean')
      return res.status(400).json({ error: 'statsAccess должен быть boolean' });
    const updated = await store.setPermission(login, { statsAccess });
    res.json({ login, ...updated });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/my-permissions', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') return res.json({ statsAccess: true });
    res.json(await store.getPermission(req.user.login));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
