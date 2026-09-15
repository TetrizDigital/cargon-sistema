// Integracao Mercado Livre: OAuth + sync de vendas
const axios = require('axios');
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

function buildAuthUrl() {
  const c = cfg();
  return `${AUTH_URL}?response_type=code&client_id=${c.clientId}&redirect_uri=${encodeURIComponent(c.redirectUri)}`;
}

async function exchangeCodeForToken(code) {
  const c = cfg();
  const resp = await axios.post(`${BASE_URL}/oauth/token`, new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    redirect_uri: c.redirectUri,
  }));
  const t = resp.data;
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
  const resp = await axios.post(`${BASE_URL}/oauth/token`, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: row.refresh_token,
  }));
  saveToken(resp.data);
  return resp.data.access_token;
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
  const r = await axios.get(BASE_URL + pathReq, {
    params,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20_000,
  });
  return r.data;
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
      upsertVenda(o);
      processados++;
    }

    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
                VALUES ('MERCADO_LIVRE', 'vendas', 'ok', ?, ?)`)
      .run(processados, `desde ${desde}`);

    return { ok: true, processados, ms: Date.now() - inicio };
  } catch (err) {
    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, mensagem)
                VALUES ('MERCADO_LIVRE', 'vendas', 'erro', ?)`)
      .run(err.message);
    throw err;
  }
}

function upsertVenda(o) {
  const idExt = String(o.id);
  const data = o.date_created;
  const status = o.status;
  const valor = o.total_amount || 0;
  const shipping = o.shipping || {};
  const buyer = o.buyer || {};

  const info = db.prepare(`
    INSERT INTO vendas (canal, id_externo_pedido, data_venda, status, comprador_nome, comprador_email, valor_total, valor_frete, taxa_canal, valor_liquido, data_repasse_previsto)
    VALUES ('MERCADO_LIVRE', ?, ?, ?, ?, ?, ?, ?, ?, ?, date(?, '+30 days'))
    ON CONFLICT(canal, id_externo_pedido) DO UPDATE SET
      status = excluded.status,
      valor_total = excluded.valor_total,
      atualizado_em = datetime('now')
  `).run(
    idExt, data, status,
    buyer.nickname || (buyer.first_name + ' ' + buyer.last_name).trim(),
    buyer.email || null,
    valor,
    shipping.cost || 0,
    valor * 0.155, // taxa ML aprox
    valor * (1 - 0.155) - (shipping.cost || 0),
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

    // Baixa estoque (se venda paga e produto vinculado)
    if (produtoId && (status === 'paid' || status === 'shipped' || status === 'delivered')) {
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

module.exports = { buildAuthUrl, exchangeCodeForToken, syncVendas, apiGet, getAccessToken };
