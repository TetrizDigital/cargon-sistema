// Integracao com o site cargonparts.com.br (endpoint /api/sync/pedidos)
// Usa fetch nativo do Node 18+
const { db } = require('../db');

function cfg() {
  return {
    baseUrl: process.env.SITE_API_BASE_URL || 'https://cargonparts.com.br',
    apiKey: process.env.SITE_API_KEY,
  };
}

async function syncVendas() {
  const inicio = Date.now();
  let processados = 0;
  try {
    const c = cfg();
    if (!c.apiKey) throw new Error('SITE_API_KEY nao configurada');

    const ultima = db.prepare(`
      SELECT MAX(data_venda) AS max_data FROM vendas WHERE canal = 'SITE_PROPRIO'
    `).get().max_data;
    const since = ultima || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const url = new URL(`${c.baseUrl}/api/sync/pedidos`);
    url.searchParams.set('since', since);
    url.searchParams.set('limit', '100');
    const r = await fetch(url.toString(), {
      headers: { 'X-Api-Key': c.apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    for (const p of (data.pedidos || data.orders || [])) {
      upsertVendaSite(p);
      processados++;
    }

    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
                VALUES ('SITE_PROPRIO', 'vendas', 'ok', ?, ?)`)
      .run(processados, `desde ${since}`);

    return { ok: true, processados, ms: Date.now() - inicio };
  } catch (err) {
    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, mensagem)
                VALUES ('SITE_PROPRIO', 'vendas', 'erro', ?)`)
      .run(err.message);
    throw err;
  }
}

function upsertVendaSite(p) {
  const idExt = p.id;
  const data = p.paid_at || p.created_at;

  // Detecta cancelamento pra devolver estoque
  const vendaAnterior = db.prepare(
    "SELECT id, status FROM vendas WHERE canal = 'SITE_PROPRIO' AND id_externo_pedido = ?"
  ).get(idExt);
  const foiCancelada = vendaAnterior
    && ['pago', 'enviado', 'entregue'].includes(vendaAnterior.status)
    && ['cancelado', 'reembolsado'].includes(p.status);
  if (foiCancelada) {
    const saidas = db.prepare(`
      SELECT produto_id, quantidade FROM movimentos_estoque
      WHERE referencia_tipo = 'venda' AND referencia_id = ? AND tipo = 'SAIDA_VENDA'
    `).all(vendaAnterior.id);
    const jaDevolveu = db.prepare(`
      SELECT 1 FROM movimentos_estoque
      WHERE referencia_tipo = 'venda' AND referencia_id = ? AND tipo = 'RETORNO_CANCELAMENTO' LIMIT 1
    `).get(vendaAnterior.id);
    if (!jaDevolveu) {
      for (const s of saidas) {
        const devolucao = Math.abs(s.quantidade);
        const pp = db.prepare('SELECT estoque_atual FROM produtos WHERE id = ?').get(s.produto_id);
        if (!pp) continue;
        const novoSaldo = pp.estoque_atual + devolucao;
        db.prepare('UPDATE produtos SET estoque_atual = ?, atualizado_em = datetime(\'now\') WHERE id = ?').run(novoSaldo, s.produto_id);
        db.prepare(`
          INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
          VALUES (?, 'RETORNO_CANCELAMENTO', ?, ?, 'venda', ?, ?)
        `).run(s.produto_id, devolucao, novoSaldo, vendaAnterior.id, 'Site pedido ' + idExt + ' cancelado');
      }
    }
  }

  const info = db.prepare(`
    INSERT INTO vendas (canal, id_externo_pedido, data_venda, status, comprador_nome, comprador_email, comprador_telefone, valor_total, valor_frete, frete_confirmado, taxa_canal, valor_liquido)
    VALUES ('SITE_PROPRIO', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
    ON CONFLICT(canal, id_externo_pedido) DO UPDATE SET
      status = excluded.status,
      atualizado_em = datetime('now')
  `).run(
    idExt, data, p.status,
    p.buyer_name, p.buyer_email, p.buyer_phone,
    p.total, p.shipping_cost || 0,
    (p.total || 0) - (p.shipping_cost || 0),
  );

  const vendaId = info.lastInsertRowid || db.prepare(
    'SELECT id FROM vendas WHERE canal = ? AND id_externo_pedido = ?'
  ).get('SITE_PROPRIO', idExt).id;

  db.prepare('DELETE FROM itens_venda WHERE venda_id = ?').run(vendaId);
  for (const it of (p.items || [])) {
    const vinc = it.product_id ? db.prepare(
      "SELECT produto_id FROM produto_vinculos WHERE canal = 'SITE_PROPRIO' AND id_externo = ?"
    ).get(String(it.product_id)) : null;
    const produtoId = vinc ? vinc.produto_id : null;

    let custo = 0;
    if (produtoId) {
      const pp = db.prepare('SELECT custo_unitario FROM produtos WHERE id = ?').get(produtoId);
      custo = pp ? pp.custo_unitario : 0;
    }

    db.prepare(`
      INSERT INTO itens_venda (venda_id, produto_id, descricao, quantidade, preco_unitario, custo_unitario)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(vendaId, produtoId, it.title, it.qty, it.unit_price, custo);

    const dataCorte = require('../db').getSetting('estoque_data_corte', '');
    const vendaDepoisDoCorte = !dataCorte || data >= dataCorte;
    if (produtoId && vendaDepoisDoCorte && (p.status === 'pago' || p.status === 'enviado' || p.status === 'entregue')) {
      const existente = db.prepare(`
        SELECT id FROM movimentos_estoque
        WHERE produto_id = ? AND referencia_tipo = 'venda' AND referencia_id = ?
      `).get(produtoId, vendaId);
      if (!existente) {
        const pp = db.prepare('SELECT estoque_atual FROM produtos WHERE id = ?').get(produtoId);
        const novoSaldo = pp.estoque_atual - it.qty;
        db.prepare('UPDATE produtos SET estoque_atual = ? WHERE id = ?').run(novoSaldo, produtoId);
        db.prepare(`
          INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
          VALUES (?, 'SAIDA_VENDA', ?, ?, 'venda', ?, ?)
        `).run(produtoId, -it.qty, novoSaldo, vendaId, 'Site pedido ' + idExt);
      }
    }
  }

  // Caixa
  const existLanc = db.prepare(
    "SELECT id FROM lancamentos_caixa WHERE venda_id = ? AND categoria = 'VENDA'"
  ).get(vendaId);
  if (!existLanc && (p.status === 'pago' || p.status === 'enviado' || p.status === 'entregue')) {
    db.prepare(`
      INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, status, venda_id)
      VALUES ('ENTRADA', 'VENDA', ?, ?, ?, 'realizado', ?)
    `).run('Site pedido ' + idExt, (p.total || 0) - (p.shipping_cost || 0), data.slice(0, 10), vendaId);
  }
}

module.exports = { syncVendas };
