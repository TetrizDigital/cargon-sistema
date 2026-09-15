// Cargon Sistema - servidor Express principal
require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const cron = require('node-cron');

const { db, getSetting, setSetting } = require('./db');
const auth = require('./routes/auth');
const produtos = require('./routes/produtos');
const vendas = require('./routes/vendas');
const estoque = require('./routes/estoque');
const financeiro = require('./routes/financeiro');
const sync = require('./routes/sync');

const ml = require('./integrations/mercadolivre');
const site = require('./integrations/site');

const PORT = process.env.PORT || 3010;

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const stored = getSetting('_session_secret');
  if (stored) return stored;
  const s = 'cgn-sis-' + crypto.randomBytes(32).toString('hex');
  setSetting('_session_secret', s);
  console.log('[security] SESSION_SECRET gerado e persistido no banco.');
  return s;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
  store: new MemoryStore({ checkPeriod: 1000 * 60 * 60 * 24 }),
}));

// -------- middleware de auth --------
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'nao autenticado' });
  }
  next();
}

app.locals.requireAuth = requireAuth;

// -------- health check publico --------
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    servico: 'cargon-sistema',
    versao: require('./package.json').version,
    hora: new Date().toISOString(),
  });
});

// -------- rotas de autenticacao (publicas) --------
app.use('/api/auth', auth);

// -------- rotas protegidas --------
app.use('/api/produtos', requireAuth, produtos);
app.use('/api/vendas', requireAuth, vendas);
app.use('/api/estoque', requireAuth, estoque);
app.use('/api/financeiro', requireAuth, financeiro);
app.use('/api/sync', requireAuth, sync);

// -------- rotas de integracao ML (OAuth callback publico, resto protegido) --------
app.get('/api/ml/authorize', requireAuth, (_req, res) => {
  res.redirect(ml.buildAuthUrl());
});
app.get('/api/ml/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('code ausente');
    await ml.exchangeCodeForToken(code);
    res.redirect('/app.html?ml=ok');
  } catch (err) {
    console.error('[ml/callback]', err);
    res.status(500).send('erro na autenticacao ML: ' + err.message);
  }
});

// -------- paginas HTML --------
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/app.html');
  res.redirect('/login');
});
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/app.html', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// arquivos estaticos publicos (styles, app.js, imagens)
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  maxAge: '1h',
}));

// -------- 404 --------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'rota nao encontrada' });
  }
  res.status(404).send('404 - nao encontrado');
});

// -------- error handler --------
app.use((err, req, res, _next) => {
  console.error('[erro]', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: err.message || 'erro interno' });
  }
  res.status(500).send('erro interno');
});

// -------- jobs de sync (agenda apenas se SYNC_ENABLED=true) --------
if (process.env.SYNC_ENABLED === 'true') {
  const mlCron = process.env.SYNC_ML_CRON || '*/15 * * * *';
  const siteCron = process.env.SYNC_SITE_CRON || '7,22,37,52 * * * *';
  const contasCron = process.env.CONTAS_RECORRENTES_CRON || '0 3 * * *';

  cron.schedule(mlCron, () => {
    ml.syncVendas().catch(err => console.error('[cron ml]', err));
  });
  cron.schedule(siteCron, () => {
    site.syncVendas().catch(err => console.error('[cron site]', err));
  });
  cron.schedule(contasCron, () => {
    financeiro.gerarLancamentosRecorrentes().catch(err => console.error('[cron contas]', err));
  });

  console.log('[cron] agendado: ML=' + mlCron + ' Site=' + siteCron + ' Contas=' + contasCron);
} else {
  console.log('[cron] SYNC_ENABLED != true, jobs nao agendados');
}

app.listen(PORT, () => {
  console.log('[cargon-sistema] rodando em porta ' + PORT + ' - ' + (process.env.NODE_ENV || 'dev'));
});
