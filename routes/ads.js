// Rotas Mercado Ads
const express = require('express');
const { db } = require('../db');
const ads = require('../integrations/mercadoads');

const router = express.Router();

router.get('/resumo', (req, res) => {
  const de = req.query.de || new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const ate = req.query.ate || new Date().toISOString().slice(0, 10);

  const totais = db.prepare(`
    SELECT
      COUNT(*) AS total_campanhas,
      COALESCE(SUM(cost), 0) AS gasto_total,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(prints), 0) AS prints,
      COALESCE(SUM(direct_amount), 0) AS direct_amount,
      COALESCE(SUM(total_amount), 0) AS total_amount
    FROM ads_metricas
    WHERE periodo_de = ? AND periodo_ate = ?
  `).get(de, ate);

  const ctr_medio = totais.prints > 0 ? (totais.clicks / totais.prints) * 100 : 0;
  const cpc_medio = totais.clicks > 0 ? totais.gasto_total / totais.clicks : 0;
  const acos_geral = totais.total_amount > 0 ? (totais.gasto_total / totais.total_amount) * 100 : 0;
  const roas = totais.gasto_total > 0 ? totais.total_amount / totais.gasto_total : 0;

  const porCampanha = db.prepare(`
    SELECT c.campaign_id, c.nome, c.status, c.daily_budget,
           m.clicks, m.prints, m.cost, m.cpc, m.ctr, m.acos, m.direct_amount, m.total_amount
    FROM ads_campanhas c
    LEFT JOIN ads_metricas m ON m.campaign_id = c.campaign_id AND m.periodo_de = ? AND m.periodo_ate = ?
    ORDER BY COALESCE(m.cost, 0) DESC
  `).all(de, ate);

  res.json({
    periodo: { de, ate },
    totais: {
      ...totais,
      ctr_medio,
      cpc_medio,
      acos_geral,
      roas,
    },
    campanhas: porCampanha,
  });
});

router.get('/campanhas', (_req, res) => {
  const rows = db.prepare('SELECT * FROM ads_campanhas ORDER BY nome').all();
  res.json(rows);
});

// Metricas por anuncio (MLB) - une com SKU do sistema via produto_vinculos
router.get('/items', (req, res) => {
  const de = req.query.de || new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const ate = req.query.ate || new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT ai.*, pv.produto_id, p.sku, p.nome AS produto_nome, p.estoque_atual,
           c.nome AS campanha_nome
    FROM ads_items ai
    LEFT JOIN produto_vinculos pv ON pv.canal = 'MERCADO_LIVRE' AND pv.id_externo = ai.item_id
    LEFT JOIN produtos p ON p.id = pv.produto_id
    LEFT JOIN ads_campanhas c ON c.campaign_id = ai.campaign_id
    WHERE ai.periodo_de = ? AND ai.periodo_ate = ?
    ORDER BY ai.cost DESC
  `).all(de, ate);

  const totais = db.prepare(`
    SELECT COUNT(*) AS qtd,
           COALESCE(SUM(cost), 0) AS gasto,
           COALESCE(SUM(clicks), 0) AS clicks,
           COALESCE(SUM(prints), 0) AS prints,
           COALESCE(SUM(direct_amount), 0) AS direct_amount,
           COALESCE(SUM(total_amount), 0) AS total_amount
    FROM ads_items
    WHERE periodo_de = ? AND periodo_ate = ?
  `).get(de, ate);

  const ctr = totais.prints > 0 ? (totais.clicks / totais.prints) * 100 : 0;
  const cpc = totais.clicks > 0 ? totais.gasto / totais.clicks : 0;
  const roas = totais.gasto > 0 ? totais.total_amount / totais.gasto : 0;
  const acos = totais.total_amount > 0 ? (totais.gasto / totais.total_amount) * 100 : 0;

  res.json({
    periodo: { de, ate },
    totais: { ...totais, ctr_medio: ctr, cpc_medio: cpc, roas, acos_geral: acos },
    items: rows,
  });
});

module.exports = router;
