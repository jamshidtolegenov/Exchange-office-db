require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const { initSchema } = require('./db/store');

const authRouter       = require('./routes/auth');
const balancesRouter   = require('./routes/balances');
const ratesRouter      = require('./routes/rates');
const operationsRouter = require('./routes/operations');
const statsRouter      = require('./routes/stats');
const settingsRouter   = require('./routes/settings');

const app  = express();
const PORT = process.env.PORT || 4000;

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
  process.env.FRONTEND_URL,
  'https://exchange-office-six.vercel.app',
].filter(Boolean);

function normalizeOrigin(origin) {
  return origin ? origin.replace(/\/$/, '') : origin;
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    if (ALLOWED_ORIGINS.includes(normalized)) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`CORS: Origin "${origin}" not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

app.use('/api/auth',       authRouter);
app.use('/api/balances',   balancesRouter);
app.use('/api/rates',      ratesRouter);
app.use('/api/operations', operationsRouter);
app.use('/api/stats',      statsRouter);
app.use('/api/settings',   settingsRouter);

app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ error: `Маршрут ${req.path} не найден` }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message || err);
  res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

// ── Bootstrap: init DB schema then start server ───────────────────────────────
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Backend запущен: http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   CORS allowed: ${ALLOWED_ORIGINS.join(', ')}`);
    });
  })
  .catch(err => {
    console.error('❌ Не удалось инициализировать БД:', err.message);
    process.exit(1);
  });
