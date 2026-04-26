const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'exchange_secret_key_change_in_prod';

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Токен не передан' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Токен недействителен или истёк' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

function operatorOnly(req, res, next) {
  if (req.user?.role !== 'operator')
    return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

module.exports = { authMiddleware, adminOnly, operatorOnly, JWT_SECRET };
