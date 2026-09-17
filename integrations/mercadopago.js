// Integracao Mercado Pago: sync de pagamentos via Access Token direto
// Usa fetch nativo Node 18+
const { db } = require('../db');

const BASE_URL = 'https://api.mercadopago.com';

function token() {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error('MP_ACCESS_TOKEN nao configurado');
  return t;
}

async function mpGet(pathReq, params = {}) {
  const url = new URL(BASE_URL + pathReq);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`MP HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

async function userMe() {
  return await mpGet('/users/me');
}

// Sync de pagamentos: busca /v1/payments/search desde ultima data
async function syncPayments() {
  const inicio = Date.now();
  let processados = 0;

  try {
    // determina 'desde'
    const ultima = db.prepare(`
      SELECT MAX(date_last_updated) AS max_data FROM movimentos_mp
    `).get().max_data;
    const desde = ultima || new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(); // 60 dias

    // MP aceita begin_date/end_date com formato ISO com timezone
    let offset = 0;
    const limit = 50;
    let totalRetornado = 0;

    while (true) {
      const dados = await mpGet('/v1/payments/search', {
        sort: 'date_created',
        criteria: 'desc',
        range: 'date_last_updated',
        begin_date: desde,
        end_date: 'NOW',
        limit,
        offset,
      });

      const results = dados.results || [];
      totalRetornado = dados.paging?.total || results.length;

      for (const p of results) {
        upsertPayment(p);
        processados++;
      }

      offset += results.length;
      if (results.length < limit || offset >= totalRetornado) break;
      if (offset > 500) break; // safety cap
    }

    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
                VALUES ('MERCADO_PAGO', 'payments', 'ok', ?, ?)`)
      .run(processados, `desde ${desde}`);

    return { ok: true, processados, ms: Date.now() - inicio };
  } catch (err) {
    db.prepare(`INSERT INTO sync_logs (canal, tipo, status, mensagem)
                VALUES ('MERCADO_PAGO', 'payments', 'erro', ?)`)
      .run(err.message);
    throw err;
  }
}

function upsertPayment(p) {
  // extrai fee_details
  const fees = Array.isArray(p.fee_details) ? p.fee_details : [];
  const mpFee = fees.filter(f => f.type === 'mercadopago_fee').reduce((s, f) => s + (f.amount || 0), 0);
  const outras = fees.filter(f => f.type !== 'mercadopago_fee').reduce((s, f) => s + (f.amount || 0), 0);

  // tenta linkar com venda ML se external_reference bater com id_externo_pedido
  let vendaId = null;
  if (p.external_reference) {
    const v = db.prepare(`
      SELECT id FROM vendas WHERE id_externo_pedido = ?
    `).get(String(p.external_reference));
    if (v) vendaId = v.id;
  }

  // extrai descricao
  const descricao = p.description
    || (p.additional_info?.items?.[0]?.title)
    || null;

  // extrai nome do pagador
  const payerNome = p.payer?.first_name
    ? (p.payer.first_name + ' ' + (p.payer.last_name || '')).trim()
    : (p.payer?.email || null);

  db.prepare(`
    INSERT INTO movimentos_mp (
      mp_payment_id, tipo, status, status_detail,
      transaction_amount, net_received_amount, taxa_mp, outras_taxas,
      payment_method_id, payment_type_id,
      payer_email, payer_id, payer_nome,
      external_reference, descricao,
      money_release_date, date_created, date_approved, date_last_updated,
      venda_id, raw_json
    ) VALUES (?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mp_payment_id) DO UPDATE SET
      status = excluded.status,
      status_detail = excluded.status_detail,
      transaction_amount = excluded.transaction_amount,
      net_received_amount = excluded.net_received_amount,
      taxa_mp = excluded.taxa_mp,
      outras_taxas = excluded.outras_taxas,
      money_release_date = excluded.money_release_date,
      date_approved = excluded.date_approved,
      date_last_updated = excluded.date_last_updated,
      venda_id = COALESCE(excluded.venda_id, movimentos_mp.venda_id),
      atualizado_em = datetime('now')
  `).run(
    String(p.id),
    p.status || 'unknown',
    p.status_detail || null,
    Number(p.transaction_amount || 0),
    Number(p.transaction_details?.net_received_amount || 0),
    mpFee,
    outras,
    p.payment_method_id || null,
    p.payment_type_id || null,
    p.payer?.email || null,
    p.payer?.id ? String(p.payer.id) : null,
    payerNome,
    p.external_reference ? String(p.external_reference) : null,
    descricao,
    p.money_release_date || null,
    p.date_created,
    p.date_approved || null,
    p.date_last_updated || p.date_created,
    vendaId,
    JSON.stringify(p),
  );
}

// Calcula saldo estimado usando money_release_status (bate 100% com o painel MP,
// que soma approved+pending + in_mediation como "A receber")
function calcularSaldo() {
  // A liberar: approved + pending OU in_mediation (mesma logica do painel MP)
  const aLiberar = db.prepare(`
    SELECT COALESCE(SUM(net_received_amount), 0) AS total, COUNT(*) AS qtd
    FROM movimentos_mp
    WHERE (status = 'approved' AND json_extract(raw_json, '$.money_release_status') = 'pending')
       OR status = 'in_mediation'
  `).get();

  // Apenas approved (sem mediacao) - informativo
  const aLiberarConfirmado = db.prepare(`
    SELECT COALESCE(SUM(net_received_amount), 0) AS total, COUNT(*) AS qtd
    FROM movimentos_mp
    WHERE status = 'approved'
      AND json_extract(raw_json, '$.money_release_status') = 'pending'
  `).get();

  // Ja liberado (nos ultimos 30d) - pode ja ter sido sacado
  const liberadoRecente = db.prepare(`
    SELECT COALESCE(SUM(net_received_amount), 0) AS total, COUNT(*) AS qtd
    FROM movimentos_mp
    WHERE status = 'approved'
      AND json_extract(raw_json, '$.money_release_status') = 'released'
      AND date(money_release_date) >= date('now', '-30 days')
  `).get();

  // Refunds recentes
  const refunds = db.prepare(`
    SELECT COALESCE(SUM(net_received_amount), 0) AS total, COUNT(*) AS qtd
    FROM movimentos_mp
    WHERE status IN ('refunded', 'charged_back')
      AND date(date_created) >= date('now', '-60 days')
  `).get();

  // Em mediacao (subconjunto de "a liberar")
  const mediacao = db.prepare(`
    SELECT COALESCE(SUM(net_received_amount), 0) AS total, COUNT(*) AS qtd
    FROM movimentos_mp
    WHERE status = 'in_mediation'
  `).get();

  return {
    a_liberar: aLiberar.total,               // total como MP mostra
    a_liberar_qtd: aLiberar.qtd,
    a_liberar_confirmado: aLiberarConfirmado.total,  // so approved (sem mediacao)
    a_liberar_confirmado_qtd: aLiberarConfirmado.qtd,
    liberado_30d: liberadoRecente.total,
    liberado_30d_qtd: liberadoRecente.qtd,
    refunds_60d: refunds.total,
    refunds_60d_qtd: refunds.qtd,
    em_mediacao: mediacao.total,
    em_mediacao_qtd: mediacao.qtd,
  };
}

module.exports = { syncPayments, calcularSaldo, mpGet, userMe };
