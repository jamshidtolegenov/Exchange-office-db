const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { store } = require('../db/store');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password)
      return res.status(400).json({ error: 'Введите логин и пароль' });

    const user = await store.findUser(login);
    const hash = await store.getPasswordHash(login);

    if (!user || !hash)
      return res.status(401).json({ error: 'Неверный логин или пароль' });

    const passwordMatch = bcrypt.compareSync(String(password), hash);
    if (!passwordMatch)
      return res.status(401).json({ error: 'Неверный логин или пароль' });

    const payload = { id: user.id, login: user.login, role: user.role, city: user.city, label: user.label };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token, user: payload });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    return res.status(500).json({ error: 'Ошибка сервера при авторизации' });
  }
});

module.exports = router;
