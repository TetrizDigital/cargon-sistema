// Rotas de produtos (SKUs) e vinculos com canais externos
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Listar todos com qtd_anunciada por canal (comparar estoque real vs anunciado)
router.get('/', (req, res) => {
  const filtro = req.query.q ? '%' + req.query.q + '%' : null;
  const query = filtro
    ? 'SELECT * FROM produtos WHERE (nome LIKE ? OR sku LIKE ? OR modelo LIKE ?) ORDER BY nome'
    : 'SELECT * FROM produtos ORDER BY nome';
  const rows = filtro ? db.prepare(query).all(filtro, filtro, filtro) : db.prepare(query).all();

  // Anexa qtd_anunciada por canal (soma de todos os anuncios daquele canal)
  const stmt = db.prepare(`
    SELECT canal, COALESCE(SUM(qtd_anunciada), 0) AS total_anunciado,
           MAX(qtd_anunciada_atualizado) AS ultima_leitura
    FROM produto_vinculos
    WHERE produto_id = ? AND ativo = 1 AND qtd_anunciada IS NOT NULL
    GROUP BY canal
  `);
  for (const p of rows) {
    p.anunciado = stmt.all(p.id);
    p.total_anunciado_ml = (p.anunciado.find(a => a.canal === 'MERCADO_LIVRE') || {}).total_anunciado || 0;
  }
  res.json(rows);
});

// Detalhes de um produto (com vinculos e ultimas movimentacoes)
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
  if (!produto) return res.status(404).json({ error: 'produto nao encontrado' });

  const vinculos = db.prepare('SELECT * FROM produto_vinculos WHERE produto_id = ? AND ativo = 1').all(id);
  const movimentos = db.prepare(`
    SELECT * FROM movimentos_estoque
    WHERE produto_id = ?
    ORDER BY criado_em DESC LIMIT 20
  `).all(id);

  res.json({ ...produto, vinculos, movimentos });
});

// Criar produto
router.post('/', (req, res) => {
  const {
    sku, nome, modelo, ano_de, ano_ate,
    custo_unitario = 0, preco_venda = 0, frete_estimado = 0,
    estoque_atual = 0, estoque_minimo = 1, observacao = null,
  } = req.body || {};

  if (!sku || !nome) {
    return res.status(400).json({ error: 'sku e nome sao obrigatorios' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO produtos (sku, nome, modelo, ano_de, ano_ate, custo_unitario, preco_venda, frete_estimado, estoque_atual, estoque_minimo, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sku, nome, modelo, ano_de, ano_ate, custo_unitario, preco_venda, frete_estimado, estoque_atual, estoque_minimo, observacao);

    if (estoque_atual > 0) {
      db.prepare(`
        INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, observacao, criado_por)
        VALUES (?, 'AJUSTE', ?, ?, 'saldo_inicial', 'Saldo inicial ao criar produto', ?)
      `).run(info.lastInsertRowid, estoque_atual, estoque_atual, req.session.userId);
    }

    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'sku ja existe' });
    }
    throw err;
  }
});

// Atualizar
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existente = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
  if (!existente) return res.status(404).json({ error: 'produto nao encontrado' });

  const campos = ['nome', 'modelo', 'ano_de', 'ano_ate', 'custo_unitario', 'preco_venda', 'frete_estimado', 'estoque_minimo', 'ativo', 'observacao'];
  const updates = [];
  const values = [];
  for (const c of campos) {
    if (c in (req.body || {})) {
      updates.push(c + ' = ?');
      values.push(req.body[c]);
    }
  }
  if (updates.length === 0) return res.json({ ok: true, changed: 0 });

  updates.push("atualizado_em = datetime('now')");
  values.push(id);
  const sql = 'UPDATE produtos SET ' + updates.join(', ') + ' WHERE id = ?';
  const info = db.prepare(sql).run(...values);
  res.json({ ok: true, changed: info.changes });
});

// Adicionar vinculo (produto -> canal externo)
router.post('/:id/vinculos', (req, res) => {
  const produto_id = Number(req.params.id);
  const { canal, id_externo, url } = req.body || {};
  if (!canal || !id_externo) {
    return res.status(400).json({ error: 'canal e id_externo obrigatorios' });
  }
  try {
    const info = db.prepare(`
      INSERT INTO produto_vinculos (produto_id, canal, id_externo, url)
      VALUES (?, ?, ?, ?)
    `).run(produto_id, canal, id_externo, url || null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'ja existe vinculo para esse canal+id_externo' });
    }
    throw err;
  }
});

// Remover vinculo
router.delete('/vinculos/:vinculoId', (req, res) => {
  const info = db.prepare('DELETE FROM produto_vinculos WHERE id = ?').run(Number(req.params.vinculoId));
  res.json({ ok: true, changed: info.changes });
});

module.exports = router;
