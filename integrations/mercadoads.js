// Integracao Mercado Ads (Product Ads) - usa o mesmo token do ML
const ml = require('./mercadolivre');
const { db: dbLocal } = require('../db');

async function adsGet(pathReq, params = {}) {
  const token = await ml.getAccessToken();
  const url = new URL('https://api.mercadolibre.com' + pathReq);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'api-version': '2',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Ads HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

async function getAdvertiserId() {
  const cached = dbLocal.prepare('SELECT value FROM settings WHERE key = ?').get('ads_advertiser_id');
  if (cached) return cached.value;

  const data = await adsGet('/advertising/advertisers', { product_id: 'PADS' });
  const advertisers = data.advertisers || [];
  if (advertisers.length === 0) throw new Error('Nenhum advertiser account encontrado');
  const advId = String(advertisers[0].advertiser_id);
  dbLocal.prepare(`
    INSERT INTO settings (key, value, atualizado_em) VALUES ('ads_advertiser_id', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(advId);
  return advId;
}

async function syncCampanhas(dateFrom, dateTo) {
  const inicio = Date.now();
  const advId = await getAdvertiserId();
  const de = dateFrom || primeiroDiaDoMes();
  const ate = dateTo || hoje();

  let processados = 0;
  try {
    let offset = 0;
    const limit = 50;
    while (true) {
      const data = await adsGet(`/marketplace/advertising/MLB/advertisers/${advId}/product_ads/campaigns/search`, {
        limit, offset,
        date_from: de,
        date_to: ate,
        metrics: 'clicks,prints,ctr,cost,cpc,acos,direct_amount,total_amount,organic_units_quantity',
      });
      const results = data.results || [];
      if (results.length === 0) break;

      for (const c of results) {
        upsertCampanha(advId, c);
        if (c.metrics) upsertMetricas(c.id, de, ate, c.metrics);
        processados++;
      }
      offset += results.length;
      const total = data.paging?.total || results.length;
      if (offset >= total) break;
      if (offset > 500) break;
    }

    dbLocal.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
                     VALUES ('MERCADO_ADS', 'campanhas', 'ok', ?, ?)`)
      .run(processados, `periodo ${de} a ${ate}`);
    return { ok: true, processados, ms: Date.now() - inicio, periodo: { de, ate } };
  } catch (err) {
    dbLocal.prepare(`INSERT INTO sync_logs (canal, tipo, status, mensagem)
                     VALUES ('MERCADO_ADS', 'campanhas', 'erro', ?)`)
      .run(err.message);
    throw err;
  }
}

function upsertCampanha(advId, c) {
  dbLocal.prepare(`
    INSERT INTO ads_campanhas (advertiser_id, campaign_id, nome, status, strategy, channel, budget, daily_budget, automatic_budget, acos_target, roas_target, date_created, last_updated, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(campaign_id) DO UPDATE SET
      nome = excluded.nome,
      status = excluded.status,
      strategy = excluded.strategy,
      channel = excluded.channel,
      budget = excluded.budget,
      daily_budget = excluded.daily_budget,
      automatic_budget = excluded.automatic_budget,
      acos_target = excluded.acos_target,
      roas_target = excluded.roas_target,
      last_updated = excluded.last_updated,
      atualizado_em = datetime('now')
  `).run(
    advId, String(c.id), c.name, c.status, c.strategy, c.channel,
    c.budget, c.daily_budget, c.automatic_budget ? 1 : 0,
    c.acos_target, c.roas_target,
    c.date_created, c.last_updated,
  );
}

function upsertMetricas(campaignId, de, ate, m) {
  dbLocal.prepare(`
    INSERT INTO ads_metricas (campaign_id, periodo_de, periodo_ate, clicks, prints, cost, cpc, ctr, acos, direct_amount, total_amount, organic_units_quantity, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(campaign_id, periodo_de, periodo_ate) DO UPDATE SET
      clicks = excluded.clicks,
      prints = excluded.prints,
      cost = excluded.cost,
      cpc = excluded.cpc,
      ctr = excluded.ctr,
      acos = excluded.acos,
      direct_amount = excluded.direct_amount,
      total_amount = excluded.total_amount,
      organic_units_quantity = excluded.organic_units_quantity,
      atualizado_em = datetime('now')
  `).run(
    String(campaignId), de, ate,
    m.clicks || 0, m.prints || 0, m.cost || 0,
    m.cpc || 0, m.ctr || 0, m.acos || 0,
    m.direct_amount || 0, m.total_amount || 0,
    m.organic_units_quantity || 0,
  );

  // Tambem cria/atualiza lancamento no caixa (categoria MARKETING) para o custo do periodo
  const camp = dbLocal.prepare('SELECT nome FROM ads_campanhas WHERE campaign_id = ?').get(String(campaignId));
  if (camp && (m.cost || 0) > 0) {
    dbLocal.prepare(`
      DELETE FROM lancamentos_caixa
      WHERE categoria = 'OUTRA_DESPESA'
        AND observacao LIKE ?
        AND data >= ?
        AND data <= ?
    `).run('ads_campaign:' + campaignId + '%', de, ate);

    dbLocal.prepare(`
      INSERT INTO lancamentos_caixa (tipo, categoria, descricao, valor, data, status, observacao)
      VALUES ('SAIDA', 'OUTRA_DESPESA', ?, ?, ?, 'realizado', ?)
    `).run(
      'Mercado Ads: ' + camp.nome + ' (' + de + ' a ' + ate + ')',
      Number(m.cost || 0),
      ate, // data do periodo final
      'ads_campaign:' + campaignId + ':' + de + ':' + ate,
    );
  }
}

function primeiroDiaDoMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// Sincroniza metricas POR ANUNCIO (MLB) - resposta com thumbnail e permalink
async function syncItems(dateFrom, dateTo) {
  const inicio = Date.now();
  const advId = await getAdvertiserId();
  const de = dateFrom || primeiroDiaDoMes();
  const ate = dateTo || hoje();

  let processados = 0;
  try {
    let offset = 0;
    const limit = 50;
    while (true) {
      const data = await adsGet(`/marketplace/advertising/MLB/advertisers/${advId}/product_ads/ads/search`, {
        limit, offset,
        date_from: de,
        date_to: ate,
        metrics: 'clicks,prints,cost,cpc,ctr,acos,direct_amount,indirect_amount,total_amount',
      });
      const results = data.results || [];
      if (results.length === 0) break;

      for (const a of results) {
        upsertAdItem(a, de, ate);
        processados++;
      }
      offset += results.length;
      const total = data.paging?.total || results.length;
      if (offset >= total) break;
      if (offset > 1000) break;
    }

    dbLocal.prepare(`INSERT INTO sync_logs (canal, tipo, status, itens_processados, mensagem)
                     VALUES ('MERCADO_ADS', 'items', 'ok', ?, ?)`)
      .run(processados, `periodo ${de} a ${ate}`);
    return { ok: true, processados, ms: Date.now() - inicio, periodo: { de, ate } };
  } catch (err) {
    dbLocal.prepare(`INSERT INTO sync_logs (canal, tipo, status, mensagem)
                     VALUES ('MERCADO_ADS', 'items', 'erro', ?)`)
      .run(err.message);
    throw err;
  }
}

function upsertAdItem(a, de, ate) {
  const m = a.metrics || {};
  dbLocal.prepare(`
    INSERT INTO ads_items (item_id, periodo_de, periodo_ate, title, price, status, thumbnail, permalink, campaign_id, ad_group_id, clicks, prints, cost, cpc, ctr, acos, direct_amount, indirect_amount, total_amount, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(item_id, periodo_de, periodo_ate) DO UPDATE SET
      title = excluded.title, price = excluded.price, status = excluded.status,
      thumbnail = excluded.thumbnail, permalink = excluded.permalink,
      campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id,
      clicks = excluded.clicks, prints = excluded.prints, cost = excluded.cost,
      cpc = excluded.cpc, ctr = excluded.ctr, acos = excluded.acos,
      direct_amount = excluded.direct_amount, indirect_amount = excluded.indirect_amount,
      total_amount = excluded.total_amount,
      atualizado_em = datetime('now')
  `).run(
    a.item_id, de, ate,
    a.title, a.price, a.status,
    a.thumbnail, a.permalink,
    a.campaign_id ? String(a.campaign_id) : null,
    a.ad_group_id ? String(a.ad_group_id) : null,
    m.clicks || 0, m.prints || 0, m.cost || 0,
    m.cpc || 0, m.ctr || 0, m.acos || 0,
    m.direct_amount || 0, m.indirect_amount || 0, m.total_amount || 0,
  );
}

module.exports = { syncCampanhas, syncItems, getAdvertiserId, adsGet };
