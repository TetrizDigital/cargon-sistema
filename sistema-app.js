// Cargon Sistema - Express sub-app
// Feito para ser montado em outra app: app.use('/sistema', require('./sistema/sistema-app'))
// Tambem pode rodar standalone via server.js (dev local)

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);

const { db, getSetting, setSetting } = require('./db');
const auth = require('./routes/auth');
const produtos = require('./routes/produtos');
const vendas = require('./routes/vendas');
const estoque = require('./routes/estoque');
const financeiro = require('./routes/financeiro');
const sync = require('./routes/sync');

const ml = require('./integrations/mercadolivre');
const site = require('./integrations/site');

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const stored = getSetting('_session_secret');
  if (stored) return stored;
  const s = 'cgn-sis-' + crypto.randomBytes(32).toString('hex');
  setSetting('_session_secret', s);
  return s;
}

const app = express();

// Body parsing — pode duplicar com host app, mas Express é ok com isso
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Session isolada (nome de cookie diferente pra nao conflitar com o site)
app.use(session({
  name: 'sistema_sid',
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/sistema',
  },
  store: new MemoryStore({ checkPeriod: 1000 * 60 * 60 * 24 }),
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.accepts('html')) return res.redirect(req.baseUrl + '/login');
    return res.status(401).json({ error: 'nao autenticado' });
  }
  next();
}

// -------- health check publico --------
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    servico: 'cargon-sistema',
    versao: require('./package.json').version,
    hora: new Date().toISOString(),
  });
});

// -------- rotas de auth (publicas) --------
app.use('/api/auth', auth);

// -------- rotas protegidas --------
app.use('/api/produtos', requireAuth, produtos);
app.use('/api/vendas', requireAuth, vendas);
app.use('/api/estoque', requireAuth, estoque);
app.use('/api/financeiro', requireAuth, financeiro);
app.use('/api/sync', requireAuth, sync);

// -------- OAuth ML --------
app.get('/api/ml/authorize', requireAuth, (_req, res) => {
  res.redirect(ml.buildAuthUrl());
});
app.get('/api/ml/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('code ausente');
    await ml.exchangeCodeForToken(code);
    res.redirect(req.baseUrl + '/app.html?ml=ok');
  } catch (err) {
    console.error('[sistema][ml/callback]', err);
    res.status(500).send('erro na autenticacao ML: ' + err.message);
  }
});

// -------- paginas HTML --------
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect(req.baseUrl + '/app.html');
  res.redirect(req.baseUrl + '/login');
});
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/app.html', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  maxAge: '1h',
}));

// 404 dentro do /sistema
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'rota nao encontrada' });
  res.status(404).send('sistema: rota nao encontrada');
});

app.use((err, req, res, _next) => {
  console.error('[sistema][erro]', err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: err.message || 'erro interno' });
  res.status(500).send('sistema: erro interno');
});

// -------- jobs de sync (com setInterval em vez de cron) --------
if (process.env.SYNC_ENABLED === 'true' && !global.__sistema_cron_started) {
  global.__sistema_cron_started = true;

  const ML_INTERVAL_MS = 15 * 60 * 1000;      // 15 min
  const SITE_INTERVAL_MS = 15 * 60 * 1000;    // 15 min (offset)
  const CONTAS_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h (verifica se mes virou)

  setTimeout(() => {
    setInterval(() => { ml.syncVendas().catch(e => console.error('[sistema][cron ml]', e.message)); }, ML_INTERVAL_MS);
  }, 60_000);

  setTimeout(() => {
    setInterval(() => { site.syncVendas().catch(e => console.error('[sistema][cron site]', e.message)); }, SITE_INTERVAL_MS);
  }, 7 * 60 * 1000);

  setTimeout(() => {
    setInterval(() => { financeiro.gerarLancamentosRecorrentes().catch(e => console.error('[sistema][cron contas]', e.message)); }, CONTAS_INTERVAL_MS);
  }, 3 * 60 * 1000);

  console.log('[sistema] jobs de sync agendados (setInterval)');
}

// -------- setup inicial de usuarios (idempotente) --------
try {
  const bcrypt = require('bcryptjs');
  function upsertUser(email, name, senha, role = 'admin') {
    if (!senha || !email) return;
    const hash = bcrypt.hashSync(senha, 10);
    const existing = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      // so atualiza se hash ainda for de env inicial (nao sobrescreve senha trocada pelo usuario)
      const stored = getSetting('_seeded_users:' + email.toLowerCase());
      if (stored !== '1') {
        db.prepare('UPDATE users SET password_hash = ?, name = ?, role = ?, ativo = 1 WHERE id = ?').run(hash, name, role, existing.id);
        setSetting('_seeded_users:' + email.toLowerCase(), '1');
        console.log('[sistema] senha inicial aplicada para ' + email);
      }
    } else {
      db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)').run(email.toLowerCase(), hash, name, role);
      setSetting('_seeded_users:' + email.toLowerCase(), '1');
      console.log('[sistema] usuario criado: ' + email);
    }
  }
  if (process.env.ADMIN_EMAIL_LEANDRO && process.env.ADMIN_SENHA_LEANDRO) {
    upsertUser(process.env.ADMIN_EMAIL_LEANDRO, 'Leandro', process.env.ADMIN_SENHA_LEANDRO);
  }
  if (process.env.ADMIN_EMAIL_RAFAEL && process.env.ADMIN_SENHA_RAFAEL) {
    upsertUser(process.env.ADMIN_EMAIL_RAFAEL, 'Rafael', process.env.ADMIN_SENHA_RAFAEL);
  }
} catch (err) {
  console.error('[sistema] falha no setup de usuarios:', err.message);
}

module.exports = app;
