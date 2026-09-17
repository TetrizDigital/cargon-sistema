// Pedidos de compra (Oliver Parts + outros fornecedores)
const express = require('express');
const { db, getSetting } = require('../db');

const router = express.Router();

// ============ FORNECEDORES ============
router.get('/fornecedores', (_req, res) => {
  const rows = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome').all();
  res.json(rows);
});

router.post('/fornecedores', (req, res) => {
  const { nome, contato, observacao } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'nome obrigatorio' });
  try {
    const info = db.prepare('INSERT INTO fornecedores (nome, contato, observacao) VALUES (?, ?, ?)')
      .run(nome, contato || null, observacao || null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'fornecedor ja existe' });
    throw err;
  }
});

router.put('/fornecedores/:id', (req, res) => {
  const id = Number(req.params.id);
  const { nome, contato, observacao, ativo } = req.body || {};
  const info = db.prepare('UPDATE fornecedores SET nome = COALESCE(?, nome), contato = COALESCE(?, contato), observacao = COALESCE(?, observacao), ativo = COALESCE(?, ativo) WHERE id = ?')
    .run(nome, contato, observacao, ativo, id);
  res.json({ ok: true, changed: info.changes });
});

// ============ PEDIDOS ============
router.get('/', (req, res) => {
  const status = req.query.status;
  const cond = status ? 'WHERE pc.status = ?' : '';
  const rows = db.prepare(`
    SELECT pc.*, f.nome AS fornecedor_nome,
      (SELECT COUNT(*) FROM pedidos_compra_itens WHERE pedido_id = pc.id) AS itens_count,
      (SELECT SUM(quantidade) FROM pedidos_compra_itens WHERE pedido_id = pc.id) AS total_pecas
    FROM pedidos_compra pc
    JOIN fornecedores f ON f.id = pc.fornecedor_id
    ${cond}
    ORDER BY pc.data_pedido DESC, pc.id DESC
  `).all(...(status ? [status] : []));
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const pedido = db.prepare(`
    SELECT pc.*, f.nome AS fornecedor_nome
    FROM pedidos_compra pc JOIN fornecedores f ON f.id = pc.fornecedor_id
    WHERE pc.id = ?
  `).get(id);
  if (!pedido) return res.status(404).json({ error: 'nao encontrado' });
  const itens = db.prepare(`
    SELECT pci.*, p.sku, p.nome AS produto_nome
    FROM pedidos_compra_itens pci
    JOIN produtos p ON p.id = pci.produto_id
    WHERE pci.pedido_id = ?
  `).all(id);
  res.json({ ...pedido, itens });
});

router.post('/', (req, res) => {
  const { fornecedor_id, data_pedido, itens = [], observacao } = req.body || {};
  if (!fornecedor_id || !data_pedido) return res.status(400).json({ error: 'fornecedor_id e data_pedido obrigatorios' });
  if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'itens obrigatorios (array)' });

  const trans = db.transaction(() => {
    let valor_total = 0;
    for (const it of itens) {
      if (!it.produto_id || !it.quantidade || !it.custo_unitario) throw new Error('cada item precisa de produto_id, quantidade e custo_unitario');
      valor_total += it.quantidade * it.custo_unitario;
    }

    const info = db.prepare(`
      INSERT INTO pedidos_compra (fornecedor_id, data_pedido, valor_total, status, observacao, criado_por)
      VALUES (?, ?, ?, 'aberto', ?, ?)
    `).run(fornecedor_id, data_pedido, valor_total, observacao || null, req.session.userId);
    const pedido_id = info.lastInsertRowid;

    const insItem = db.prepare('INSERT INTO pedidos_compra_itens (pedido_id, produto_id, quantidade, custo_unitario) VALUES (?, ?, ?, ?)');
    for (const it of itens) {
      insItem.run(pedido_id, it.produto_id, it.quantidade, it.custo_unitario);
    }
    return pedido_id;
  });

  try {
    const id = trans();
    res.status(201).json({ id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const pedido = db.prepare('SELECT status FROM pedidos_compra WHERE id = ?').get(id);
  if (!pedido) return res.status(404).json({ error: 'nao encontrado' });
  if (pedido.status !== 'aberto') return res.status(400).json({ error: 'so pedidos abertos podem ser editados' });

  const campos = ['fornecedor_id', 'data_pedido', 'observacao'];
  const upd = [];
  const vals = [];
  for (const c of campos) {
    if (c in (req.body || {})) { upd.push(c + ' = ?'); vals.push(req.body[c]); }
  }
  if (upd.length === 0) return res.json({ ok: true });
  vals.push(id);
  db.prepare('UPDATE pedidos_compra SET ' + upd.join(', ') + ' WHERE id = ?').run(...vals);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT status FROM pedidos_compra WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'nao encontrado' });
  if (p.status !== 'aberto') return res.status(400).json({ error: 'so pedidos abertos podem ser deletados' });
  db.prepare('DELETE FROM pedidos_compra WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Receber pedido: baixa estoque, lanca no caixa
router.post('/:id/receber', (req, res) => {
  const id = Number(req.params.id);
  const {
    data_recebimento,
    coletado_por,       // 'LEANDRO', 'RAFAEL_BOCAO', 'OUTRO'
    coletado_por_nome,  // se OUTRO
    custo_coleta,       // se OUTRO ou override
    observacao,
  } = req.body || {};

  if (!coletado_por) return res.status(400).json({ error: 'coletado_por obrigatorio' });
  if (!['LEANDRO', 'RAFAEL_BOCAO', 'OUTRO'].includes(coletado_por)) {
    return res.status(400).json({ error: 'coletado_por invalido (LEANDRO, RAFAEL_BOCAO ou OUTRO)' });
  }

  const pedido = db.prepare('SELECT * FROM pedidos_compra WHERE id = ?').get(id);
  if (!pedido) return res.status(404).json({ error: 'nao encontrado' });
  if (pedido.status !== 'aberto') return res.status(400).json({ error: 'pedido nao esta aberto (status: ' + pedido.status + ')' });

  // Determina custo_coleta
  let coleta_final;
  if (custo_coleta != null) {
    coleta_final = Number(custo_coleta);
  } else if (coletado_por === 'RAFAEL_BOCAO') {
    coleta_final = Number(getSetting('custo_coleta_rafael_bocao', '110'));
  } else if (coletado_por === 'LEANDRO') {
    coleta_final = 0;
  } else {
    return res.status(400).json({ error: 'custo_coleta obrigatorio quando coletado_por = OUTRO' });
  }

  const dataRec = data_recebimento || new Date().toISOString().slice(0, 10);

  const itens = db.prepare(`
    SELECT pci.*, p.nome AS produto_nome, p.estoque_atual
    FROM pedidos_compra_itens pci
    JOIN produtos p ON p.id = pci.produto_id
    WHERE pci.pedido_id = ?
  `).all(id);

  if (itens.length === 0) return res.status(400).json({ error: 'pedido sem itens' });

  const trans = db.transaction(() => {
    // Atualiza pedido
    db.prepare(`
      UPDATE pedidos_compra
      SET status = 'recebido',
          data_recebimento = ?,
          coletado_por = ?,
          coletado_por_nome = ?,
          custo_coleta = ?,
          recebido_em = datetime('now'),
          observacao = COALESCE(?, observacao)
      WHERE id = ?
    `).run(dataRec, coletado_por, coletado_por_nome || null, coleta_final, observacao || null, id);

    // Rateio do frete de coleta entre as peças (quando coleta_final > 0)
    const totalPecas = itens.reduce((s, it) => s + it.quantidade, 0);
    const rateioPorPeca = (coleta_final > 0 && totalPecas > 0) ? (coleta_final / totalPecas) : 0;

    // Entrada de estoque + atualiza custo (custo unitario absorve o rateio do frete)
    for (const it of itens) {
      const novoSaldo = it.estoque_atual + it.quantidade;
      const custoComRateio = Number(it.custo_unitario) + rateioPorPeca;
      db.prepare(`UPDATE produtos SET estoque_atual = ?, custo_unitario = ?, atualizado_em = datetime('now') WHERE id = ?`)
        .run(novoSaldo, custoComRateio, it.produto_id);

      const obsRateio = rateioPorPeca > 0 ? ' (+ R$' + rateioPorPeca.toFixed(2) + ' rateio frete)' : '';
      db.prepare(`
        INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao, criado_por)
        VALUES (?, 'ENTRADA_COMPRA', ?, ?, 'pedido_compra', ?, ?, ?)
      `).run(it.produto_id, it.quantidade, novoSaldo, id, 'Pedido #' + id + obsRateio, req.session.userId);
    }

    // Lancamento no caixa: compra fornecedor
    db.prepare(`
      INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, status, observacao, criado_por)
      VALUES ('SAIDA', 'COMPRA_FORNECEDOR', ?, ?, ?, 'realizado', ?, ?)
    `).run(
      'Compra pedido #' + id + ' - ' + itens.length + ' item(s)',
      pedido.valor_total,
      dataRec,
      'Fornecedor: ' + (db.prepare('SELECT nome FROM fornecedores WHERE id = ?').get(pedido.fornecedor_id) || {}).nome,
      req.session.userId
    );

    // Lancamento adicional: frete/coleta (se > 0)
    if (coleta_final > 0) {
      const desc = coletado_por === 'RAFAEL_BOCAO'
        ? 'Coleta pedido #' + id + ' - Rafael Bocao'
        : coletado_por === 'OUTRO'
          ? 'Coleta pedido #' + id + ' - ' + (coletado_por_nome || 'Outro')
          : 'Coleta pedido #' + id;
      db.prepare(`
        INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, status, observacao, criado_por)
        VALUES ('SAIDA', 'FRETE', ?, ?, ?, 'realizado', ?, ?)
      `).run(desc, coleta_final, dataRec, 'Coleta na fabrica', req.session.userId);
    }
  });

  trans();
  res.json({ ok: true, pedido_id: id, custo_coleta: coleta_final });
});

router.post('/:id/cancelar', (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT status FROM pedidos_compra WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'nao encontrado' });
  if (p.status !== 'aberto') return res.status(400).json({ error: 'so pedidos abertos podem ser cancelados' });
  db.prepare(`UPDATE pedidos_compra SET status = 'cancelado' WHERE id = ?`).run(id);
  res.json({ ok: true });
});

module.exports = router;
