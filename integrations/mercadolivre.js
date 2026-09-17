// Integracao Mercado Livre: OAuth + sync de vendas
// Usa fetch nativo do Node 18+ (sem axios pra evitar dep extra)
const { db } = require('../db');

const BASE_URL = 'https://api.mercadolibre.com';
const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';

function cfg() {
  return {
    clientId: process.env.ML_CLIENT_ID,
    clientSecret: process.env.ML_CLIENT_SECRET,
    redirectUri: process.env.ML_REDIRECT_URI,
  };
}

async function httpJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${url}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

function buildAuthUrl() {
  const c = cfg();
  return `${AUTH_URL}?response_type=code&client_id=${c.clientId}&redirect_uri=${encodeURIComponent(c.redirectUri)}`;
}

async function exchangeCodeForToken(code) {
  const c = cfg();
  const t = await httpJson(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code,
      redirect_uri: c.redirectUri,
    }).toString(),
  });
  saveToken(t);
  return t;
}

function saveToken(t) {
  const expira = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
  db.prepare(`
    INSERT INTO integracao_ml (ml_user_id, access_token, refresh_token, expira_em, atualizado_em)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(ml_user_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expira_em = excluded.expira_em,
      atualizado_em = datetime('now')
  `).run(String(t.user_id), t.access_token, t.refresh_token, expira);
}

async function refreshToken(row) {
  const c = cfg();
  const t = await httpJson(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: row.refresh_token,
    }).toString(),
  });
  saveToken(t);
  return t.access_token;
}

async function getAccessToken() {
  const row = db.prepare('SELECT * FROM integracao_ml ORDER BY id LIMIT 1').get();
  if (!row) throw new Error('ML nao autenticado. Chame /api/ml/authorize primeiro.');

  const expiraEm = new Date(row.expira_em).getTime();
  if (Date.now() >= expiraEm - 60_000) {
    return await refreshToken(row);
  }
  return row.access_token;
}

async function apiGet(pathReq, params = {}) {
  const token = await getAccessToken();
  const url = new URL(BASE_URL + pathReq);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return await httpJson(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
}

// -------- Sync de vendas --------
async function syncVendas() {
  const inicio = Date.now();
  let processados = 0;
  try {
    const row = db.prepare('SELECT * FROM integracao_ml ORDER BY id LIMIT 1').get();
    if (!row) throw new Error('ML nao autenticado');

    const ultima = db.prepare(`
      SELECT MAX(data_venda) AS max_data FROM vendas WHERE canal = 'MERCADO_LIVRE'
    `).get().max_data;

    // Se nunca sincronizou, busca 30 dias atras
    const desde = ultima || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const seller = row.ml_user_id;

    const dados = await apiGet(`/orders/search`, {
      seller,
      'order.date_created.from': desde,
      sort: 'date_desc',
      limit: 50,
    });

    for (const o of (dados.results || [])) {
      try {
        await upsertVenda(o);
        processados++;
      } catch (err) {
        console.error('[ml] erro em order ' + o.id + ':', err.message);
      }
    }

    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
                VALUES ('MERCADO_LIVRE', 'vendas', 'ok', ?, ?)`)
      .run(processados, `desde ${desde}`);

    // Atualiza qtd anunciada dos MLBs (independente do sync de vendas)
    try {
      const r = await syncEstoqueAnunciado();
      db.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
                  VALUES ('MERCADO_LIVRE', 'estoque_anunciado', 'ok', ?, ?)`)
        .run(r.atualizados, 'qtd anunciada atualizada');
    } catch (err) {
      db.prepare(`INSERT INTO sync_logs (canal, tipo, status, mensagem)
                  VALUES ('MERCADO_LIVRE', 'estoque_anunciado', 'erro', ?)`)
        .run(err.message);
    }

    return { ok: true, processados, ms: Date.now() - inicio };
  } catch (err) {
    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, mensagem)
                VALUES ('MERCADO_LIVRE', 'vendas', 'erro', ?)`)
      .run(err.message);
    throw err;
  }
}

async function upsertVenda(o) {
  const idExt = String(o.id);
  const data = o.date_created;
  const status = o.status;

  // Detecta mudanca de status pra devolver estoque em cancelamentos
  const vendaAnterior = db.prepare(
    "SELECT id, status FROM vendas WHERE canal = 'MERCADO_LIVRE' AND id_externo_pedido = ?"
  ).get(idExt);
  const foiCancelada = vendaAnterior
    && ['paid', 'shipped', 'delivered'].includes(vendaAnterior.status)
    && ['cancelled', 'refunded'].includes(status);
  if (foiCancelada) {
    devolverEstoqueVenda(vendaAnterior.id, 'ML pedido ' + idExt + ' cancelado');
  }
  const valor = o.total_amount || 0;
  const shipping = o.shipping || {};
  const buyer = o.buyer || {};

  // Comissao ML real: soma marketplace_fee de todos os payments
  const payments = Array.isArray(o.payments) ? o.payments : [];
  let mercadolibre_fee = 0;
  let payment_method = null;
  for (const p of payments) {
    const fee = Number(p.marketplace_fee || 0);
    mercadolibre_fee += fee;
    if (!payment_method && p.payment_method_id) payment_method = p.payment_method_id;
  }
  // fallback: se nao veio no payments, usa 15.5% aproximado
  const usedFeeEstimate = mercadolibre_fee <= 0;
  if (usedFeeEstimate) mercadolibre_fee = valor * 0.155;

  // Frete pago pelo vendedor: busca no shipment se tiver id
  let shipping_cost_seller = 0;
  const shipping_id = shipping.id ? String(shipping.id) : null;
  if (shipping_id) {
    try {
      const shp = await apiGet(`/shipments/${shipping_id}`);
      // varios campos possiveis dependendo do modo do envio
      shipping_cost_seller = Number(
        shp.cost ||
        shp.shipping_option?.cost ||
        shp.base_cost ||
        0
      );
    } catch (err) {
      // shipment pode nao existir ainda (envio pendente)
      console.warn('[ml][shipment ' + shipping_id + ']', err.message);
    }
  }

  const valor_frete_comprador = shipping.cost || 0;
  const valor_liquido = valor - mercadolibre_fee - shipping_cost_seller;
  const taxa_detalhes = JSON.stringify({
    payments: payments.map(p => ({
      id: p.id,
      transaction_amount: p.transaction_amount,
      marketplace_fee: p.marketplace_fee,
      status: p.status,
      payment_method_id: p.payment_method_id,
    })),
    fee_estimada: usedFeeEstimate,
  });

  const info = db.prepare(`
    INSERT INTO vendas (canal, id_externo_pedido, data_venda, status, comprador_nome, comprador_email, valor_total, valor_frete, taxa_canal, mercadolibre_fee, shipping_cost_seller, shipping_id, payment_method, taxa_detalhes, valor_liquido, data_repasse_previsto)
    VALUES ('MERCADO_LIVRE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date(?, '+30 days'))
    ON CONFLICT(canal, id_externo_pedido) DO UPDATE SET
      status = excluded.status,
      valor_total = excluded.valor_total,
      valor_frete = excluded.valor_frete,
      taxa_canal = excluded.taxa_canal,
      mercadolibre_fee = excluded.mercadolibre_fee,
      shipping_cost_seller = excluded.shipping_cost_seller,
      shipping_id = excluded.shipping_id,
      payment_method = excluded.payment_method,
      taxa_detalhes = excluded.taxa_detalhes,
      valor_liquido = excluded.valor_liquido,
      atualizado_em = datetime('now')
  `).run(
    idExt, data, status,
    buyer.nickname || (buyer.first_name + ' ' + buyer.last_name).trim(),
    buyer.email || null,
    valor,
    valor_frete_comprador,
    mercadolibre_fee, // taxa_canal mantido = fee real (compat)
    mercadolibre_fee,
    shipping_cost_seller,
    shipping_id,
    payment_method,
    taxa_detalhes,
    valor_liquido,
    data,
  );

  const vendaId = info.lastInsertRowid || db.prepare(
    'SELECT id FROM vendas WHERE canal = ? AND id_externo_pedido = ?'
  ).get('MERCADO_LIVRE', idExt).id;

  // Itens
  db.prepare('DELETE FROM itens_venda WHERE venda_id = ?').run(vendaId);
  for (const it of (o.order_items || [])) {
    const mlbId = it.item && it.item.id;
    const vinc = mlbId ? db.prepare(
      "SELECT produto_id FROM produto_vinculos WHERE canal = 'MERCADO_LIVRE' AND id_externo = ?"
    ).get(mlbId) : null;
    const produtoId = vinc ? vinc.produto_id : null;

    let custo = 0;
    if (produtoId) {
      const p = db.prepare('SELECT custo_unitario FROM produtos WHERE id = ?').get(produtoId);
      custo = p ? p.custo_unitario : 0;
    }

    db.prepare(`
      INSERT INTO itens_venda (venda_id, produto_id, descricao, quantidade, preco_unitario, custo_unitario)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(vendaId, produtoId, it.item.title, it.quantity, it.unit_price, custo);

    // Baixa estoque (se venda paga, produto vinculado e venda apos data de corte)
    const dataCorte = require('../db').getSetting('estoque_data_corte', '');
    const vendaDepoisDoCorte = !dataCorte || data >= dataCorte;
    if (produtoId && vendaDepoisDoCorte && (status === 'paid' || status === 'shipped' || status === 'delivered')) {
      const existente = db.prepare(`
        SELECT id FROM movimentos_estoque
        WHERE produto_id = ? AND referencia_tipo = 'venda' AND referencia_id = ?
      `).get(produtoId, vendaId);
      if (!existente) {
        const p = db.prepare('SELECT estoque_atual FROM produtos WHERE id = ?').get(produtoId);
        const novoSaldo = p.estoque_atual - it.quantity;
        db.prepare('UPDATE produtos SET estoque_atual = ? WHERE id = ?').run(novoSaldo, produtoId);
        db.prepare(`
          INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
          VALUES (?, 'SAIDA_VENDA', ?, ?, 'venda', ?, ?)
        `).run(produtoId, -it.quantity, novoSaldo, vendaId, 'ML pedido ' + idExt);
      }
    }
  }

  // Lancamento no caixa (previsto ate confirmar entrega)
  const existLanc = db.prepare(
    "SELECT id FROM lancamentos_caixa WHERE venda_id = ? AND categoria = 'VENDA'"
  ).get(vendaId);
  if (!existLanc && (status === 'paid' || status === 'shipped' || status === 'delivered')) {
    db.prepare(`
      INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, data_prevista, status, venda_id)
      VALUES ('ENTRADA', 'VENDA', ?, ?, ?, date(?, '+30 days'),
              CASE WHEN ? = 'delivered' THEN 'realizado' ELSE 'previsto' END, ?)
    `).run(
      'ML pedido ' + idExt,
      valor * (1 - 0.155) - (shipping.cost || 0),
      data.slice(0, 10),
      data,
      status,
      vendaId,
    );
  }
}

// Atualiza qtd_anunciada dos MLBs vinculados (para painel de comparacao com estoque real)
async function syncEstoqueAnunciado() {
  const vinculos = db.prepare(`
    SELECT DISTINCT id_externo FROM produto_vinculos
    WHERE canal = 'MERCADO_LIVRE' AND ativo = 1
  `).all();
  if (vinculos.length === 0) return { atualizados: 0 };

  // /items suporta ate 20 ids por chamada
  const ids = vinculos.map(v => v.id_externo);
  let atualizados = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    try {
      const data = await apiGet('/items?ids=' + batch.join(',') + '&attributes=id,available_quantity,sold_quantity,status');
      for (const wrap of data) {
        if (wrap.code !== 200) continue;
        const item = wrap.body;
        db.prepare(`
          UPDATE produto_vinculos
          SET qtd_anunciada = ?, qtd_anunciada_atualizado = datetime('now')
          WHERE canal = 'MERCADO_LIVRE' AND id_externo = ?
        `).run(item.available_quantity, item.id);
        atualizados++;
      }
    } catch (err) {
      console.error('[ml][sync estoque anunciado batch]', err.message);
    }
  }
  return { atualizados };
}

// Devolve o estoque previamente baixado por uma venda (usado quando venda vira cancelled)
function devolverEstoqueVenda(vendaId, motivo) {
  const saidas = db.prepare(`
    SELECT produto_id, quantidade FROM movimentos_estoque
    WHERE referencia_tipo = 'venda' AND referencia_id = ? AND tipo = 'SAIDA_VENDA'
  `).all(vendaId);
  if (saidas.length === 0) return;

  // Evita devolver 2x
  const jaDevolveu = db.prepare(`
    SELECT 1 FROM movimentos_estoque
    WHERE referencia_tipo = 'venda' AND referencia_id = ? AND tipo = 'RETORNO_CANCELAMENTO'
    LIMIT 1
  `).get(vendaId);
  if (jaDevolveu) return;

  for (const s of saidas) {
    const devolucao = Math.abs(s.quantidade); // saida vem negativa, devolvo positivo
    const p = db.prepare('SELECT estoque_atual FROM produtos WHERE id = ?').get(s.produto_id);
    if (!p) continue;
    const novoSaldo = p.estoque_atual + devolucao;
    db.prepare('UPDATE produtos SET estoque_atual = ?, atualizado_em = datetime(\'now\') WHERE id = ?').run(novoSaldo, s.produto_id);
    db.prepare(`
      INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
      VALUES (?, 'RETORNO_CANCELAMENTO', ?, ?, 'venda', ?, ?)
    `).run(s.produto_id, devolucao, novoSaldo, vendaId, motivo);
  }
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForToken,
  syncVendas,
  syncEstoqueAnunciado,
  apiGet,
  getAccessToken,
  _upsertVendaFromOrder: upsertVenda,
};
