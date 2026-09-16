// Rotas financeiras: lancamentos, resumo, contas recorrentes
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Resumo do periodo (entradas, saidas, saldo, taxas ML, frete, lucro real)
router.get('/resumo', (req, res) => {
  const de = req.query.de || new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const ate = req.query.ate || new Date().toISOString().slice(0, 10);

  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN tipo = 'ENTRADA' AND status = 'realizado' THEN valor ELSE 0 END) AS entradas,
      SUM(CASE WHEN tipo = 'SAIDA'   AND status = 'realizado' THEN valor ELSE 0 END) AS saidas,
      SUM(CASE WHEN tipo = 'ENTRADA' AND status = 'previsto'  THEN valor ELSE 0 END) AS entradas_previstas,
      SUM(CASE WHEN tipo = 'SAIDA'   AND status = 'previsto'  THEN valor ELSE 0 END) AS saidas_previstas
    FROM lancamentos_caixa
    WHERE date(data) BETWEEN date(?) AND date(?)
  `).get(de, ate);

  const porCategoria = db.prepare(`
    SELECT categoria, tipo, SUM(valor) AS total, COUNT(*) AS qtd
    FROM lancamentos_caixa
    WHERE date(data) BETWEEN date(?) AND date(?) AND status = 'realizado'
    GROUP BY categoria, tipo
    ORDER BY total DESC
  `).all(de, ate);

  // Metricas de vendas ML/Site no periodo (independente de lancamento no caixa)
  const vendasStats = db.prepare(`
    SELECT
      canal,
      COUNT(*) AS qtd_vendas,
      SUM(valor_total)                     AS receita_bruta,
      SUM(mercadolibre_fee)                AS taxas_ml,
      SUM(shipping_cost_seller)            AS frete_pago,
      SUM(valor_liquido)                   AS receita_liquida
    FROM vendas
    WHERE date(data_venda) BETWEEN date(?) AND date(?)
      AND status IN ('paid', 'shipped', 'delivered', 'pago', 'enviado', 'entregue')
    GROUP BY canal
  `).all(de, ate);

  // CMV (custo dos produtos vendidos) — sum de custo_unitario * quantidade dos itens vendidos
  const cmv = db.prepare(`
    SELECT COALESCE(SUM(iv.custo_unitario * iv.quantidade), 0) AS total
    FROM itens_venda iv
    JOIN vendas v ON v.id = iv.venda_id
    WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
      AND v.status IN ('paid', 'shipped', 'delivered', 'pago', 'enviado', 'entregue')
  `).get(de, ate).total;

  const totais = vendasStats.reduce((acc, r) => ({
    qtd: acc.qtd + r.qtd_vendas,
    receita_bruta: acc.receita_bruta + (r.receita_bruta || 0),
    taxas_ml: acc.taxas_ml + (r.taxas_ml || 0),
    frete_pago: acc.frete_pago + (r.frete_pago || 0),
    receita_liquida: acc.receita_liquida + (r.receita_liquida || 0),
  }), { qtd: 0, receita_bruta: 0, taxas_ml: 0, frete_pago: 0, receita_liquida: 0 });

  const lucro_bruto = totais.receita_liquida - cmv;
  const taxa_media_pct = totais.receita_bruta > 0 ? (totais.taxas_ml / totais.receita_bruta) * 100 : 0;
  const ticket_medio = totais.qtd > 0 ? totais.receita_bruta / totais.qtd : 0;

  res.json({
    periodo: { de, ate },
    entradas: stats.entradas || 0,
    saidas: stats.saidas || 0,
    saldo: (stats.entradas || 0) - (stats.saidas || 0),
    entradas_previstas: stats.entradas_previstas || 0,
    saidas_previstas: stats.saidas_previstas || 0,
    saldo_previsto: (stats.entradas_previstas || 0) - (stats.saidas_previstas || 0),
    por_categoria: porCategoria,
    vendas: {
      por_canal: vendasStats,
      totais,
      cmv,
      lucro_bruto,
      taxa_media_pct,
      ticket_medio,
    },
  });
});

// Listar lancamentos
router.get('/lancamentos', (req, res) => {
  const de = req.query.de || new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const ate = req.query.ate || new Date().toISOString().slice(0, 10);
  const tipo = req.query.tipo;
  const status = req.query.status;

  const conds = ['date(data) BETWEEN date(?) AND date(?)'];
  const params = [de, ate];
  if (tipo) { conds.push('tipo = ?'); params.push(tipo); }
  if (status) { conds.push('status = ?'); params.push(status); }

  const rows = db.prepare(`
    SELECT * FROM lancamentos_caixa
    WHERE ${conds.join(' AND ')}
    ORDER BY data DESC, id DESC
  `).all(...params);
  res.json(rows);
});

// Criar lancamento
router.post('/lancamentos', (req, res) => {
  const {
    tipo, categoria, descricao, valor, data,
    data_prevista = null, status = 'realizado', observacao = null,
  } = req.body || {};
  if (!tipo || !categoria || !descricao || !valor || !data) {
    return res.status(400).json({ error: 'tipo, categoria, descricao, valor, data obrigatorios' });
  }
  if (!['ENTRADA', 'SAIDA'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo deve ser ENTRADA ou SAIDA' });
  }

  const info = db.prepare(`
    INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, data_prevista, status, observacao, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tipo, categoria, descricao, Number(valor), data, data_prevista, status, observacao, req.session.userId);

  res.status(201).json({ id: info.lastInsertRowid });
});

// Atualizar
router.put('/lancamentos/:id', (req, res) => {
  const id = Number(req.params.id);
  const campos = ['tipo', 'categoria', 'descricao', 'valor', 'data', 'data_prevista', 'status', 'observacao'];
  const updates = [];
  const values = [];
  for (const c of campos) {
    if (c in (req.body || {})) {
      updates.push(c + ' = ?');
      values.push(req.body[c]);
    }
  }
  if (updates.length === 0) return res.json({ ok: true, changed: 0 });
  values.push(id);
  const info = db.prepare('UPDATE lancamentos_caixa SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
  res.json({ ok: true, changed: info.changes });
});

// Deletar
router.delete('/lancamentos/:id', (req, res) => {
  const info = db.prepare('DELETE FROM lancamentos_caixa WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, changed: info.changes });
});

// ============ CONTAS RECORRENTES (custos fixos) ============
router.get('/recorrentes', (_req, res) => {
  const rows = db.prepare('SELECT * FROM contas_recorrentes ORDER BY dia_vencimento, descricao').all();
  res.json(rows);
});

router.post('/recorrentes', (req, res) => {
  const { descricao, categoria = 'CUSTO_FIXO', valor, dia_vencimento, observacao = null } = req.body || {};
  if (!descricao || !valor || !dia_vencimento) {
    return res.status(400).json({ error: 'descricao, valor, dia_vencimento obrigatorios' });
  }
  if (dia_vencimento < 1 || dia_vencimento > 31) {
    return res.status(400).json({ error: 'dia_vencimento deve estar entre 1 e 31' });
  }
  const info = db.prepare(`
    INSERT INTO contas_recorrentes (descricao, categoria, valor, dia_vencimento, observacao)
    VALUES (?, ?, ?, ?, ?)
  `).run(descricao, categoria, Number(valor), Number(dia_vencimento), observacao);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/recorrentes/:id', (req, res) => {
  const id = Number(req.params.id);
  const campos = ['descricao', 'categoria', 'valor', 'dia_vencimento', 'ativo', 'observacao'];
  const updates = [];
  const values = [];
  for (const c of campos) {
    if (c in (req.body || {})) {
      updates.push(c + ' = ?');
      values.push(req.body[c]);
    }
  }
  if (updates.length === 0) return res.json({ ok: true });
  values.push(id);
  const info = db.prepare('UPDATE contas_recorrentes SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
  res.json({ ok: true, changed: info.changes });
});

router.delete('/recorrentes/:id', (req, res) => {
  const info = db.prepare('DELETE FROM contas_recorrentes WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, changed: info.changes });
});

// Gerador de lancamentos recorrentes (chamado pelo cron diario)
async function gerarLancamentosRecorrentes() {
  const hoje = new Date();
  const anoMes = hoje.toISOString().slice(0, 7); // YYYY-MM

  const contas = db.prepare('SELECT * FROM contas_recorrentes WHERE ativo = 1').all();
  let geradas = 0;

  for (const c of contas) {
    if (c.ultimo_gerado_em === anoMes) continue; // ja gerado neste mes

    const diaVenc = Math.min(c.dia_vencimento, new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate());
    const dataVenc = new Date(hoje.getFullYear(), hoje.getMonth(), diaVenc).toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, data_prevista, status, conta_recorrente_id)
      VALUES ('SAIDA', ?, ?, ?, ?, ?, 'previsto', ?)
    `).run(c.categoria, c.descricao + ' - ' + anoMes, c.valor, dataVenc, dataVenc, c.id);

    db.prepare('UPDATE contas_recorrentes SET ultimo_gerado_em = ? WHERE id = ?').run(anoMes, c.id);
    geradas++;
  }

  console.log('[recorrentes] ' + geradas + ' lancamentos gerados para ' + anoMes);
  return geradas;
}

router.post('/recorrentes/gerar', async (_req, res) => {
  const geradas = await gerarLancamentosRecorrentes();
  res.json({ ok: true, geradas });
});

module.exports = router;
module.exports.gerarLancamentosRecorrentes = gerarLancamentosRecorrentes;
