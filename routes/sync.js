// Rotas de sincronizacao manual + status
const express = require('express');
const { db } = require('../db');
const ml = require('../integrations/mercadolivre');
const site = require('../integrations/site');

const router = express.Router();

router.get('/status', (_req, res) => {
  const ultimosLogs = db.prepare(`
    SELECT * FROM sync_logs
    ORDER BY criado_em DESC LIMIT 20
  `).all();

  const contagem = db.prepare(`
    SELECT canal, COUNT(*) AS total,
           MAX(data_venda) AS ultima_venda
    FROM vendas
    GROUP BY canal
  `).all();

  res.json({ ultimos_logs: ultimosLogs, por_canal: contagem });
});

router.post('/mercadolivre', async (_req, res) => {
  try {
    const r = await ml.syncVendas();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/site', async (_req, res) => {
  try {
    const r = await site.syncVendas();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
