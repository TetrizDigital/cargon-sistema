// Rotas de vendas (leitura, aguardando frete, ajustes)
const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const de = req.query.de;
  const ate = req.query.ate;
  const canal = req.query.canal;
  const status = req.query.status;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const conds = [];
  const params = [];
  if (de) { conds.push('date(data_venda) >= date(?)'); params.push(de); }
  if (ate) { conds.push('date(data_venda) <= date(?)'); params.push(ate); }
  if (canal) { conds.push('canal = ?'); params.push(canal); }
  if (status) { conds.push('status = ?'); params.push(status); }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT * FROM vendas ${where}
    ORDER BY data_venda DESC, id DESC
    LIMIT ?
  `).all(...params, limit);
  res.json(rows);
});

router.get('/aguardando-frete', (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM vendas
    WHERE frete_confirmado = 0 AND status IN ('pago', 'enviado')
    ORDER BY data_venda DESC
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  if (!venda) return res.status(404).json({ error: 'venda nao encontrada' });
  const itens = db.prepare(`
    SELECT iv.*, p.sku, p.nome AS produto_nome
    FROM itens_venda iv
    LEFT JOIN produtos p ON p.id = iv.produto_id
    WHERE iv.venda_id = ?
  `).all(id);
  res.json({ ...venda, itens });
});

router.patch('/:id/frete-real', (req, res) => {
  const id = Number(req.params.id);
  const { valor_frete, observacao } = req.body || {};
  if (valor_frete == null) return res.status(400).json({ error: 'valor_frete obrigatorio' });

  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  if (!venda) return res.status(404).json({ error: 'venda nao encontrada' });

  const info = db.prepare(`
    UPDATE vendas
    SET valor_frete = ?, frete_confirmado = 1,
        observacao = COALESCE(?, observacao),
        atualizado_em = datetime('now')
    WHERE id = ?
  `).run(Number(valor_frete), observacao || null, id);

  res.json({ ok: true, changed: info.changes });
});

module.exports = router;
