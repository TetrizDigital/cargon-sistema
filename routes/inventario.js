// Inventario manual (contagem de peças)
const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT inv.*, u.name AS usuario_nome,
      (SELECT COUNT(*) FROM inventarios_itens WHERE inventario_id = inv.id) AS total_itens,
      (SELECT COUNT(*) FROM inventarios_itens WHERE inventario_id = inv.id AND qtd_contada IS NOT NULL) AS contados,
      (SELECT COALESCE(SUM(ABS(diferenca)), 0) FROM inventarios_itens WHERE inventario_id = inv.id AND diferenca IS NOT NULL) AS abs_diferencas
    FROM inventarios inv
    LEFT JOIN users u ON u.id = inv.usuario_id
    ORDER BY inv.data_contagem DESC, inv.id DESC
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const inv = db.prepare(`
    SELECT inv.*, u.name AS usuario_nome
    FROM inventarios inv LEFT JOIN users u ON u.id = inv.usuario_id
    WHERE inv.id = ?
  `).get(id);
  if (!inv) return res.status(404).json({ error: 'nao encontrado' });

  const itens = db.prepare(`
    SELECT invi.*, p.sku, p.nome AS produto_nome
    FROM inventarios_itens invi
    JOIN produtos p ON p.id = invi.produto_id
    WHERE invi.inventario_id = ?
    ORDER BY p.nome
  `).all(id);

  res.json({ ...inv, itens });
});

router.post('/', (req, res) => {
  const { data_contagem, observacao } = req.body || {};
  const data = data_contagem || new Date().toISOString().slice(0, 10);

  const trans = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO inventarios (data_contagem, usuario_id, observacao)
      VALUES (?, ?, ?)
    `).run(data, req.session.userId, observacao || null);
    const inventario_id = info.lastInsertRowid;

    const produtos = db.prepare('SELECT id, estoque_atual FROM produtos WHERE ativo = 1 ORDER BY nome').all();
    const ins = db.prepare(`
      INSERT INTO inventarios_itens (inventario_id, produto_id, qtd_antes, qtd_contada, diferenca)
      VALUES (?, ?, ?, NULL, NULL)
    `);
    for (const p of produtos) {
      ins.run(inventario_id, p.id, p.estoque_atual);
    }
    return inventario_id;
  });

  const id = trans();
  res.status(201).json({ id });
});

router.patch('/:id/itens/:itemId', (req, res) => {
  const invId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { qtd_contada } = req.body || {};

  if (qtd_contada == null || qtd_contada < 0) {
    return res.status(400).json({ error: 'qtd_contada obrigatoria (>= 0)' });
  }

  const inv = db.prepare('SELECT status FROM inventarios WHERE id = ?').get(invId);
  if (!inv) return res.status(404).json({ error: 'inventario nao encontrado' });
  if (inv.status !== 'aberto') return res.status(400).json({ error: 'inventario ja finalizado' });

  const item = db.prepare('SELECT qtd_antes FROM inventarios_itens WHERE id = ? AND inventario_id = ?').get(itemId, invId);
  if (!item) return res.status(404).json({ error: 'item nao encontrado no inventario' });

  const diferenca = Number(qtd_contada) - item.qtd_antes;
  db.prepare('UPDATE inventarios_itens SET qtd_contada = ?, diferenca = ? WHERE id = ?')
    .run(Number(qtd_contada), diferenca, itemId);

  res.json({ ok: true, diferenca });
});

router.post('/:id/finalizar', (req, res) => {
  const id = Number(req.params.id);
  const inv = db.prepare('SELECT status FROM inventarios WHERE id = ?').get(id);
  if (!inv) return res.status(404).json({ error: 'nao encontrado' });
  if (inv.status !== 'aberto') return res.status(400).json({ error: 'ja finalizado' });

  const itens = db.prepare(`
    SELECT invi.id, invi.produto_id, invi.qtd_antes, invi.qtd_contada, invi.diferenca, p.estoque_atual
    FROM inventarios_itens invi
    JOIN produtos p ON p.id = invi.produto_id
    WHERE invi.inventario_id = ? AND invi.qtd_contada IS NOT NULL
  `).all(id);

  const trans = db.transaction(() => {
    let ajustados = 0;
    for (const it of itens) {
      if (it.qtd_contada === it.estoque_atual) continue;
      const delta = it.qtd_contada - it.estoque_atual;
      db.prepare('UPDATE produtos SET estoque_atual = ?, atualizado_em = datetime(\'now\') WHERE id = ?')
        .run(it.qtd_contada, it.produto_id);
      db.prepare(`
        INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao, criado_por)
        VALUES (?, 'AJUSTE', ?, ?, 'inventario', ?, ?, ?)
      `).run(it.produto_id, delta, it.qtd_contada, id, 'Ajuste por inventario #' + id, req.session.userId);
      ajustados++;
    }
    db.prepare(`UPDATE inventarios SET status = 'finalizado', finalizado_em = datetime('now') WHERE id = ?`).run(id);
    return ajustados;
  });

  const ajustados = trans();
  res.json({ ok: true, ajustados, total_contados: itens.length });
});

router.post('/:id/cancelar', (req, res) => {
  const id = Number(req.params.id);
  const inv = db.prepare('SELECT status FROM inventarios WHERE id = ?').get(id);
  if (!inv) return res.status(404).json({ error: 'nao encontrado' });
  if (inv.status !== 'aberto') return res.status(400).json({ error: 'ja finalizado' });
  db.prepare(`UPDATE inventarios SET status = 'cancelado' WHERE id = ?`).run(id);
  res.json({ ok: true });
});

module.exports = router;
