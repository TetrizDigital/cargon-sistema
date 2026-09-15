// Rotas de estoque: movimentacoes, ajustes, alertas
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Visao geral (todos os produtos com estoque + status)
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, sku, nome, modelo, custo_unitario, preco_venda,
           estoque_atual, estoque_minimo,
           CASE
             WHEN estoque_atual <= 0 THEN 'critico'
             WHEN estoque_atual <= estoque_minimo THEN 'atencao'
             ELSE 'ok'
           END AS status_estoque,
           (estoque_atual * custo_unitario) AS valor_em_estoque
    FROM produtos
    WHERE ativo = 1
    ORDER BY status_estoque, nome
  `).all();

  const total_pecas = rows.reduce((s, r) => s + r.estoque_atual, 0);
  const valor_total = rows.reduce((s, r) => s + r.valor_em_estoque, 0);
  const criticos = rows.filter(r => r.status_estoque === 'critico').length;
  const atencao = rows.filter(r => r.status_estoque === 'atencao').length;

  res.json({
    resumo: { total_pecas, valor_total, criticos, atencao, total_skus: rows.length },
    produtos: rows,
  });
});

// So alertas (produtos abaixo do minimo)
router.get('/alertas', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, sku, nome, estoque_atual, estoque_minimo,
           CASE WHEN estoque_atual <= 0 THEN 'critico' ELSE 'atencao' END AS status_estoque
    FROM produtos
    WHERE ativo = 1 AND estoque_atual <= estoque_minimo
    ORDER BY estoque_atual ASC
  `).all();
  res.json(rows);
});

// Historico global de movimentacoes
router.get('/movimentos', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT m.*, p.sku, p.nome AS produto_nome
    FROM movimentos_estoque m
    JOIN produtos p ON p.id = m.produto_id
    ORDER BY m.criado_em DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

// Registrar entrada (compra do Oliver, por exemplo)
router.post('/entrada', (req, res) => {
  const { produto_id, quantidade, custo_unitario, valor_total, referencia, observacao } = req.body || {};
  if (!produto_id || !quantidade || quantidade <= 0) {
    return res.status(400).json({ error: 'produto_id e quantidade > 0 obrigatorios' });
  }

  const trans = db.transaction(() => {
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(produto_id);
    if (!p) throw new Error('produto nao encontrado');

    const novoSaldo = p.estoque_atual + Number(quantidade);
    db.prepare('UPDATE produtos SET estoque_atual = ?, atualizado_em = datetime(\'now\') WHERE id = ?').run(novoSaldo, produto_id);

    const custoUse = custo_unitario != null ? Number(custo_unitario) : p.custo_unitario;
    if (custo_unitario != null) {
      db.prepare('UPDATE produtos SET custo_unitario = ? WHERE id = ?').run(custoUse, produto_id);
    }

    const movInfo = db.prepare(`
      INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, observacao, criado_por)
      VALUES (?, 'ENTRADA_COMPRA', ?, ?, ?, ?, ?)
    `).run(produto_id, quantidade, novoSaldo, referencia || 'compra', observacao || null, req.session.userId);

    // Lancamento no caixa (saida)
    const valorLanc = valor_total != null ? Number(valor_total) : (custoUse * Number(quantidade));
    if (valorLanc > 0) {
      db.prepare(`
        INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, status, observacao, criado_por)
        VALUES ('SAIDA', 'COMPRA_FORNECEDOR', ?, ?, date('now'), 'realizado', ?, ?)
      `).run(
        'Compra: ' + p.nome + ' x' + quantidade,
        valorLanc,
        referencia ? 'Ref: ' + referencia : null,
        req.session.userId
      );
    }

    return { produto_id, novoSaldo, movimento_id: movInfo.lastInsertRowid };
  });

  try {
    const result = trans();
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ajuste manual (positivo ou negativo)
router.post('/ajuste', (req, res) => {
  const { produto_id, quantidade, observacao } = req.body || {};
  if (!produto_id || quantidade === undefined || quantidade === 0) {
    return res.status(400).json({ error: 'produto_id e quantidade (!=0) obrigatorios' });
  }
  const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(produto_id);
  if (!p) return res.status(404).json({ error: 'produto nao encontrado' });

  const novoSaldo = p.estoque_atual + Number(quantidade);
  if (novoSaldo < 0) return res.status(400).json({ error: 'estoque nao pode ficar negativo' });

  db.prepare('UPDATE produtos SET estoque_atual = ?, atualizado_em = datetime(\'now\') WHERE id = ?').run(novoSaldo, produto_id);
  const info = db.prepare(`
    INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, observacao, criado_por)
    VALUES (?, 'AJUSTE', ?, ?, 'ajuste_manual', ?, ?)
  `).run(produto_id, quantidade, novoSaldo, observacao || null, req.session.userId);

  res.status(201).json({ produto_id, novoSaldo, movimento_id: info.lastInsertRowid });
});

module.exports = router;
