// Rotas de sincronizacao manual + status
const express = require('express');
const { db } = require('../db');
const ml = require('../integrations/mercadolivre');
const site = require('../integrations/site');
const mp = require('../integrations/mercadopago');

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

router.post('/mercadopago', async (_req, res) => {
  try {
    const r = await mp.syncPayments();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mercadoads', async (req, res) => {
  try {
    const ads = require('../integrations/mercadoads');
    const [c, i] = await Promise.all([
      ads.syncCampanhas(req.query.de, req.query.ate),
      ads.syncItems(req.query.de, req.query.ate),
    ]);
    res.json({ campanhas: c, items: i });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recomputa taxas reais das vendas ML ja importadas
// Busca /orders/{id} pra cada e atualiza mercadolibre_fee e shipping_cost_seller
router.post('/recompute-ml', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const somenteFaltantes = req.query.todos !== '1';

  const filtro = somenteFaltantes
    ? "WHERE canal = 'MERCADO_LIVRE' AND (taxa_detalhes IS NULL OR taxa_detalhes = '')"
    : "WHERE canal = 'MERCADO_LIVRE'";

  const vendas = db.prepare(`
    SELECT id, id_externo_pedido FROM vendas ${filtro} ORDER BY data_venda DESC LIMIT ?
  `).all(limit);

  let processadas = 0;
  let erros = 0;
  for (const v of vendas) {
    try {
      const order = await ml.apiGet(`/orders/${v.id_externo_pedido}`);
      // usa a mesma logica do upsertVenda re-executando
      await ml._upsertVendaFromOrder(order);
      processadas++;
    } catch (err) {
      console.error('[recompute-ml] ' + v.id_externo_pedido + ':', err.message);
      erros++;
    }
  }

  db.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
              VALUES ('MERCADO_LIVRE', 'recompute', ?, ?, ?)`)
    .run(erros === 0 ? 'ok' : 'parcial', processadas, `recompute ${processadas} de ${vendas.length} vendas${erros ? ' (' + erros + ' erros)' : ''}`);

  res.json({ ok: true, processadas, erros, total_candidatas: vendas.length });
});

module.exports = router;
