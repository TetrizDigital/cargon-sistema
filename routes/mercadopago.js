// Rotas Mercado Pago
const express = require('express');
const { db } = require('../db');
const mp = require('../integrations/mercadopago');

const router = express.Router();

router.get('/saldo', (_req, res) => {
  const saldo = mp.calcularSaldo();

  // Proximas liberacoes: inclui approved-pending E in_mediation (bate com painel MP)
  const proximasLiberacoes = db.prepare(`
    SELECT date(money_release_date) AS data,
           COUNT(*) AS qtd,
           SUM(net_received_amount) AS valor,
           SUM(CASE WHEN status = 'in_mediation' THEN 1 ELSE 0 END) AS mediacoes
    FROM movimentos_mp
    WHERE ((status = 'approved' AND json_extract(raw_json, '$.money_release_status') = 'pending')
        OR status = 'in_mediation')
      AND money_release_date IS NOT NULL
      AND date(money_release_date) >= date('now')
      AND date(money_release_date) <= date('now', '+60 days')
    GROUP BY date(money_release_date)
    ORDER BY data
  `).all();

  // Agrupado por mes (pra comparar com painel MP)
  const porMes = db.prepare(`
    SELECT strftime('%Y-%m', money_release_date) AS mes,
           COUNT(*) AS qtd,
           SUM(net_received_amount) AS valor
    FROM movimentos_mp
    WHERE ((status = 'approved' AND json_extract(raw_json, '$.money_release_status') = 'pending')
        OR status = 'in_mediation')
      AND money_release_date IS NOT NULL
      AND date(money_release_date) >= date('now')
    GROUP BY mes
    ORDER BY mes
  `).all();

  res.json({ saldo, proximas_liberacoes: proximasLiberacoes, por_mes: porMes });
});

router.get('/movimentos', (req, res) => {
  const de = req.query.de;
  const ate = req.query.ate;
  const status = req.query.status;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const conds = [];
  const params = [];
  if (de) { conds.push('date(date_created) >= date(?)'); params.push(de); }
  if (ate) { conds.push('date(date_created) <= date(?)'); params.push(ate); }
  if (status) { conds.push('status = ?'); params.push(status); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT mp.id, mp.mp_payment_id, mp.status, mp.status_detail,
           mp.transaction_amount, mp.net_received_amount, mp.taxa_mp, mp.outras_taxas,
           mp.payment_method_id, mp.payment_type_id,
           mp.payer_email, mp.payer_nome, mp.external_reference, mp.descricao,
           mp.money_release_date, mp.date_created, mp.date_approved,
           mp.venda_id,
           v.canal AS venda_canal, v.id_externo_pedido AS venda_pedido
    FROM movimentos_mp mp
    LEFT JOIN vendas v ON v.id = mp.venda_id
    ${where}
    ORDER BY mp.date_created DESC
    LIMIT ?
  `).all(...params, limit);

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS qtd,
      COALESCE(SUM(transaction_amount), 0) AS bruto,
      COALESCE(SUM(taxa_mp), 0) AS taxas,
      COALESCE(SUM(net_received_amount), 0) AS liquido
    FROM movimentos_mp
    ${where.replace(/date_created/g, 'date_created')}
  `).get(...params);

  res.json({ movimentos: rows, resumo: stats });
});

router.get('/me', async (_req, res) => {
  try {
    const u = await mp.userMe();
    res.json({ user_id: u.id, nickname: u.nickname, email: u.email, first_name: u.first_name, site_id: u.site_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
