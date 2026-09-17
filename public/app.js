// Cargon Sistema - SPA em vanilla JS com hash routing
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('pt-BR') : '';

async function api(pathReq, opts = {}) {
  const r = await fetch(pathReq, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (r.status === 401) { window.location.href = 'login'; throw new Error('nao autenticado'); }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'erro');
  return data;
}

async function boot() {
  const user = await api('api/auth/me');
  $('#userInfo').textContent = user.name;
  $('#logoutBtn').addEventListener('click', async () => {
    await api('api/auth/logout', { method: 'POST' });
    window.location.href = 'login';
  });
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const hash = window.location.hash.replace('#/', '') || 'dashboard';
  const [name] = hash.split('/');
  $$('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  const handler = routes[name] || routes.dashboard;
  handler().catch(err => {
    $('#content').innerHTML = `<div class="card"><h3>Erro</h3><p>${err.message}</p></div>`;
  });
}

const routes = {};

// ============ DASHBOARD ============
function periodoDoMes(offsetMeses = 0) {
  const now = new Date();
  now.setMonth(now.getMonth() + offsetMeses);
  const ano = now.getFullYear();
  const mes = now.getMonth();
  const de = new Date(ano, mes, 1).toISOString().slice(0, 10);
  const ate = new Date(ano, mes + 1, 0).toISOString().slice(0, 10);
  const label = now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  return { de, ate, label, ano, mes };
}

const DASHBOARD_STATE = { offset: 0 };

routes.dashboard = async () => {
  const per = periodoDoMes(DASHBOARD_STATE.offset);
  const qs = `?de=${per.de}&ate=${per.ate}`;

  const [resumo, estoque, vendas, vendasMes, saldoMp, adsResumo] = await Promise.all([
    api('api/financeiro/resumo' + qs),
    api('api/estoque'),
    api('api/vendas' + qs + '&limit=10'),
    api('api/vendas' + qs + '&limit=500'),
    api('api/mp/saldo').catch(() => ({ saldo: { disponivel_estimado: 0, a_liberar: 0, a_liberar_qtd: 0, total: 0 } })),
    api('api/ads/resumo' + qs).catch(() => ({ totais: { gasto_total: 0, clicks: 0, prints: 0, total_amount: 0, roas: 0 } })),
  ]);

  const v = resumo.vendas || { totais: {}, cmv: 0, lucro_bruto: 0, taxa_media_pct: 0, ticket_medio: 0, por_canal: [] };
  const t = v.totais || {};
  const aReceber = resumo.a_receber_ml || { qtd: 0, total_liquido: 0, total_bruto: 0 };
  const proximosRepasses = resumo.proximos_repasses || [];
  const mpSaldo = saldoMp.saldo || { disponivel_estimado: 0, a_liberar: 0, total: 0 };
  const adsT = adsResumo.totais || { gasto_total: 0, clicks: 0, total_amount: 0, roas: 0 };
  const lucroReal = v.lucro_bruto - adsT.gasto_total;

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Dashboard</h2>
      <div class="actions" style="display:flex;gap:.5rem;align-items:center">
        <button id="btnPrevMes" class="btn-secondary">‹</button>
        <span style="min-width:180px;text-align:center;font-weight:600;text-transform:capitalize">${per.label}</span>
        <button id="btnNextMes" class="btn-secondary" ${DASHBOARD_STATE.offset >= 0 ? 'disabled' : ''}>›</button>
        <button id="btnMesAtual" class="btn-secondary" style="margin-left:.5rem">Mes atual</button>
      </div>
    </div>

    <details class="accordion" open>
      <summary>
        <span>💰 Dinheiro Mercado Pago (bate com painel oficial)</span>
        <span class="summary-info">A receber ${money(mpSaldo.a_liberar)} · ${mpSaldo.a_liberar_qtd} pgtos</span>
      </summary>
      <div class="accordion-body">
        <div class="text-small text-muted mb-1">
          Valores <strong>batem 100%</strong> com o painel MP oficial (validado com Leandro em 17/09/2026). Inclui pgtos aprovados aguardando prazo + pgtos em mediacao.
          <a href="https://www.mercadopago.com.br/activities" target="_blank" style="color:var(--amarelo);font-weight:600">abrir painel MP →</a>
        </div>
        <div class="kpi-grid">
          <div class="kpi warn">
            <div class="kpi-label">A receber (total)</div>
            <div class="kpi-value">${money(mpSaldo.a_liberar)}</div>
            <div class="kpi-sub">${mpSaldo.a_liberar_qtd} pgtos com prazo pendente</div>
          </div>
          ${mpSaldo.em_mediacao > 0 ? `
          <div class="kpi warn">
            <div class="kpi-label">Sendo em mediacao</div>
            <div class="kpi-value">${money(mpSaldo.em_mediacao)}</div>
            <div class="kpi-sub">${mpSaldo.em_mediacao_qtd} disputa em aberto (esta dentro do "A receber")</div>
          </div>` : ''}
          <div class="kpi ok">
            <div class="kpi-label">Liberados nos ultimos 30d</div>
            <div class="kpi-value">${money(mpSaldo.liberado_30d)}</div>
            <div class="kpi-sub">${mpSaldo.liberado_30d_qtd} pgtos ja disponiveis (pode ja ter sido sacado)</div>
          </div>
          ${mpSaldo.refunds_60d > 0 ? `
          <div class="kpi critico">
            <div class="kpi-label">Reembolsos (60d)</div>
            <div class="kpi-value">${money(mpSaldo.refunds_60d)}</div>
            <div class="kpi-sub">${mpSaldo.refunds_60d_qtd} vendas canceladas</div>
          </div>` : ''}
        </div>
        ${(saldoMp.por_mes || []).length > 0 ? `
        <table class="mt-1">
          <thead><tr><th>Mes</th><th class="text-right">Pgtos</th><th class="text-right">A receber</th></tr></thead>
          <tbody>
            ${saldoMp.por_mes.map(m => `
              <tr>
                <td>${m.mes}</td>
                <td class="text-right">${m.qtd}</td>
                <td class="text-right value-money positivo">${money(m.valor)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : ''}
      </div>
    </details>

    <details class="accordion" open>
      <summary>
        <span>📈 Vendas do mes (${per.label})</span>
        <span class="summary-info">${t.qtd || 0} vendas · ${money(t.receita_bruta)} receita · lucro ${money(lucroReal)}</span>
      </summary>
      <div class="accordion-body">
        <div class="chart-wrap mb-1"><canvas id="chartVendasDia"></canvas></div>
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-label">Receita bruta</div>
            <div class="kpi-value">${money(t.receita_bruta)}</div>
            <div class="kpi-sub">${t.qtd || 0} vendas · ticket ${money(v.ticket_medio)}</div>
          </div>
          <div class="kpi warn">
            <div class="kpi-label">Taxas ML</div>
            <div class="kpi-value">${money(t.taxas_ml)}</div>
            <div class="kpi-sub">${v.taxa_media_pct.toFixed(1)}% da receita</div>
          </div>
          <div class="kpi warn">
            <div class="kpi-label">Frete pago (vendedor)</div>
            <div class="kpi-value">${money(t.frete_pago)}</div>
            <div class="kpi-sub">custo real do envio</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">CMV (custo produto)</div>
            <div class="kpi-value">${money(v.cmv)}</div>
            <div class="kpi-sub">unidades vendidas × custo</div>
          </div>
          <div class="kpi warn">
            <div class="kpi-label">Gasto Mercado Ads</div>
            <div class="kpi-value">${money(adsT.gasto_total)}</div>
            <div class="kpi-sub">${adsT.clicks || 0} cliques · ROAS ${(adsT.roas || 0).toFixed(2)}x</div>
          </div>
          <div class="kpi ${lucroReal >= 0 ? 'ok' : 'warn'}">
            <div class="kpi-label">LUCRO REAL (apos Ads)</div>
            <div class="kpi-value">${money(lucroReal)}</div>
            <div class="kpi-sub">bruto − ads = lucro liquido</div>
          </div>
        </div>

        <h4 class="mt-1 mb-1">Vendas por canal</h4>
        <table>
          <thead><tr><th>Canal</th><th class="text-right">Vendas</th><th class="text-right">Receita bruta</th><th class="text-right">Taxas ML</th><th class="text-right">Frete pago</th><th class="text-right">Liquido</th></tr></thead>
          <tbody>
            ${v.por_canal.map(c => `
              <tr>
                <td><span class="badge ${badgeCanal(c.canal)}">${labelCanal(c.canal)}</span></td>
                <td class="text-right">${c.qtd_vendas}</td>
                <td class="text-right value-money">${money(c.receita_bruta)}</td>
                <td class="text-right value-money negativo">${money(c.taxas_ml)}</td>
                <td class="text-right value-money negativo">${money(c.frete_pago)}</td>
                <td class="text-right value-money positivo">${money(c.receita_liquida)}</td>
              </tr>
            `).join('') || '<tr><td colspan="6" class="text-muted">Sem vendas.</td></tr>'}
          </tbody>
        </table>

        <h4 class="mt-1 mb-1">Ultimas vendas</h4>
        <table>
          <thead><tr><th>Data</th><th>Canal</th><th>Comprador</th><th>Status</th><th class="text-right">Valor</th><th class="text-right">Repasse</th></tr></thead>
          <tbody>
            ${vendas.map(vd => `
              <tr>
                <td>${fmtDate(vd.data_venda)}</td>
                <td><span class="badge ${badgeCanal(vd.canal)}">${labelCanal(vd.canal)}</span></td>
                <td>${vd.comprador_nome || '-'}</td>
                <td>${vd.status}</td>
                <td class="text-right value-money">${money(vd.valor_total)}</td>
                <td class="text-right text-muted text-small">${vd.data_repasse_previsto ? fmtDate(vd.data_repasse_previsto) : '-'}</td>
              </tr>
            `).join('') || '<tr><td colspan="6" class="text-muted">Sem vendas.</td></tr>'}
          </tbody>
        </table>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>💸 Fluxo de caixa</span>
        <span class="summary-info">Saldo ${money(resumo.saldo)} · previsto ${money(resumo.saldo + resumo.saldo_previsto)}</span>
      </summary>
      <div class="accordion-body">
        <div class="kpi-grid">
          <div class="kpi ok">
            <div class="kpi-label">Entradas realizadas</div>
            <div class="kpi-value">${money(resumo.entradas)}</div>
            <div class="kpi-sub">previsto: ${money(resumo.entradas_previstas)}</div>
          </div>
          <div class="kpi warn">
            <div class="kpi-label">Saidas realizadas</div>
            <div class="kpi-value">${money(resumo.saidas)}</div>
            <div class="kpi-sub">previsto: ${money(resumo.saidas_previstas)}</div>
          </div>
          <div class="kpi ${resumo.saldo >= 0 ? 'ok' : 'warn'}">
            <div class="kpi-label">Saldo caixa</div>
            <div class="kpi-value">${money(resumo.saldo)}</div>
            <div class="kpi-sub">projetado: ${money(resumo.saldo + resumo.saldo_previsto)}</div>
          </div>
        </div>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>📦 Estoque</span>
        <span class="summary-info">${estoque.resumo.total_pecas} pecas · ${money(estoque.resumo.valor_total)} · ${estoque.resumo.criticos + estoque.resumo.atencao} alertas</span>
      </summary>
      <div class="accordion-body">
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-label">Estoque total</div>
            <div class="kpi-value">${estoque.resumo.total_pecas} <span style="font-size:0.9rem;color:var(--cinza-3)">pecas</span></div>
            <div class="kpi-sub">valor: ${money(estoque.resumo.valor_total)}</div>
          </div>
          <div class="kpi ${estoque.resumo.criticos > 0 ? 'warn' : ''}">
            <div class="kpi-label">Alertas de estoque</div>
            <div class="kpi-value">${estoque.resumo.criticos + estoque.resumo.atencao}</div>
            <div class="kpi-sub">${estoque.resumo.criticos} criticos, ${estoque.resumo.atencao} em atencao</div>
          </div>
        </div>
      </div>
    </details>
  `;

  // Grafico de vendas por dia do mes
  const porDia = {};
  const startDate = new Date(per.de);
  const endDate = new Date(per.ate);
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    porDia[d.toISOString().slice(0, 10)] = { ml: 0, site: 0 };
  }
  for (const vd of vendasMes) {
    const d = String(vd.data_venda).slice(0, 10);
    if (!porDia[d]) porDia[d] = { ml: 0, site: 0 };
    if (['cancelled', 'refunded', 'cancelado', 'reembolsado'].includes(vd.status)) continue;
    if (vd.canal === 'MERCADO_LIVRE') porDia[d].ml += vd.valor_total;
    else if (vd.canal === 'SITE_PROPRIO') porDia[d].site += vd.valor_total;
  }
  const labels = Object.keys(porDia).sort();
  const dataML = labels.map(l => porDia[l].ml);
  const dataSite = labels.map(l => porDia[l].site);

  const ctx = document.getElementById('chartVendasDia');
  if (ctx && typeof Chart !== 'undefined') {
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.map(l => l.slice(8, 10) + '/' + l.slice(5, 7)),
        datasets: [
          { label: 'Mercado Livre', data: dataML, backgroundColor: '#FFA500', stack: 's' },
          { label: 'Site Cargon', data: dataSite, backgroundColor: '#3b82f6', stack: 's' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (c) => c.dataset.label + ': ' + Number(c.raw).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
            },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            ticks: {
              callback: (v) => 'R$ ' + Number(v).toLocaleString('pt-BR'),
            },
          },
        },
      },
    });
  }

  $('#btnPrevMes').addEventListener('click', () => { DASHBOARD_STATE.offset--; routes.dashboard(); });
  $('#btnNextMes').addEventListener('click', () => {
    if (DASHBOARD_STATE.offset < 0) { DASHBOARD_STATE.offset++; routes.dashboard(); }
  });
  $('#btnMesAtual').addEventListener('click', () => { DASHBOARD_STATE.offset = 0; routes.dashboard(); });
};

function labelCanal(c) {
  return c === 'MERCADO_LIVRE' ? 'Mercado Livre'
       : c === 'SITE_PROPRIO' ? 'Site Cargon'
       : c === 'TIKTOK_SHOP' ? 'TikTok Shop'
       : c === 'MERCADO_PAGO' ? 'Mercado Pago'
       : c;
}
function badgeCanal(c) {
  return c === 'MERCADO_LIVRE' ? 'canal-ml'
       : c === 'SITE_PROPRIO' ? 'canal-site'
       : c === 'TIKTOK_SHOP' ? 'canal-tiktok'
       : c === 'MERCADO_PAGO' ? 'canal-ml'
       : '';
}

// ============ PRODUTOS ============
routes.produtos = async () => {
  const produtos = await api('api/produtos');
  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Produtos (${produtos.length})</h2>
      <div class="actions">
        <input id="filtroProdutos" placeholder="Buscar por nome, SKU ou modelo..." style="width: 300px" />
      </div>
    </div>
    <div class="card">
      <div class="text-small text-muted mb-1">
        <strong>Estoque real</strong> = o que voce tem fisicamente (fonte da verdade da Cargon).
        <strong>Anunciado ML</strong> = o que esta publicado nos anuncios (voce infla pra vender mais).
        <strong>Diferenca</strong> = quantas voce precisa buscar rapido no Oliver se vender.
      </div>
      <table>
        <thead>
          <tr>
            <th>SKU</th><th>Nome</th><th>Custo</th><th>Preco</th>
            <th class="text-right">Estoque real</th>
            <th class="text-right">Anunciado ML</th>
            <th class="text-right">Diferenca</th>
            <th class="text-right">Min</th><th>Status</th>
          </tr>
        </thead>
        <tbody id="produtosBody">
          ${produtos.map(rowProduto).join('')}
        </tbody>
      </table>
    </div>
  `;
  $('#filtroProdutos').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $('#produtosBody').innerHTML = produtos
      .filter(p => !q || (p.nome + ' ' + p.sku + ' ' + (p.modelo || '')).toLowerCase().includes(q))
      .map(rowProduto).join('');
  });
};
function rowProduto(p) {
  const status = p.estoque_atual <= 0 ? 'critico' : (p.estoque_atual <= p.estoque_minimo ? 'warn' : 'ok');
  const statusLabel = status === 'critico' ? 'Critico' : (status === 'warn' ? 'Atencao' : 'OK');
  const anunciado = p.total_anunciado_ml || 0;
  const diff = anunciado - p.estoque_atual;
  return `
    <tr>
      <td><code>${p.sku}</code></td>
      <td>${p.nome}</td>
      <td class="value-money">${money(p.custo_unitario)}</td>
      <td class="value-money">${money(p.preco_venda)}</td>
      <td class="text-right value-money">${p.estoque_atual}</td>
      <td class="text-right text-muted">${anunciado || '-'}</td>
      <td class="text-right ${diff > 0 ? 'value-money' : 'text-muted'}">${diff > 0 ? '+' + diff : (anunciado ? diff : '-')}</td>
      <td class="text-right text-muted">${p.estoque_minimo}</td>
      <td><span class="badge ${status}">${statusLabel}</span></td>
    </tr>
  `;
}

// ============ ESTOQUE ============
routes.estoque = async () => {
  const data = await api('api/estoque');
  $('#content').innerHTML = `
    <div class="page-header"><h2>Estoque</h2></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Pecas em estoque</div><div class="kpi-value">${data.resumo.total_pecas}</div></div>
      <div class="kpi"><div class="kpi-label">Valor total</div><div class="kpi-value">${money(data.resumo.valor_total)}</div></div>
      <div class="kpi ${data.resumo.criticos > 0 ? 'warn' : ''}"><div class="kpi-label">Criticos</div><div class="kpi-value">${data.resumo.criticos}</div></div>
      <div class="kpi"><div class="kpi-label">Atencao</div><div class="kpi-value">${data.resumo.atencao}</div></div>
    </div>
    <div class="card">
      <h3>Por SKU</h3>
      <table>
        <thead><tr><th>SKU</th><th>Nome</th><th class="text-right">Atual</th><th class="text-right">Minimo</th><th class="text-right">Valor</th><th>Status</th></tr></thead>
        <tbody>
          ${data.produtos.map(p => `
            <tr>
              <td><code>${p.sku}</code></td>
              <td>${p.nome}</td>
              <td class="text-right value-money">${p.estoque_atual}</td>
              <td class="text-right text-muted">${p.estoque_minimo}</td>
              <td class="text-right value-money">${money(p.valor_em_estoque)}</td>
              <td><span class="badge ${p.status_estoque === 'ok' ? 'ok' : p.status_estoque}">${p.status_estoque}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

// ============ VENDAS ============
routes.vendas = async () => {
  const vendas = await api('api/vendas?limit=200');
  $('#content').innerHTML = `
    <div class="page-header"><h2>Vendas (${vendas.length})</h2></div>
    <div class="card">
      <table>
        <thead>
          <tr><th>Data</th><th>Canal</th><th>ID externo</th><th>Comprador</th><th>Status</th><th class="text-right">Total</th><th class="text-right">Frete</th><th class="text-right">Liquido</th></tr>
        </thead>
        <tbody>
          ${vendas.map(v => `
            <tr>
              <td>${fmtDate(v.data_venda)}</td>
              <td><span class="badge ${badgeCanal(v.canal)}">${labelCanal(v.canal)}</span></td>
              <td><code>${v.id_externo_pedido}</code></td>
              <td>${v.comprador_nome || '-'}</td>
              <td>${v.status}</td>
              <td class="text-right value-money">${money(v.valor_total)}</td>
              <td class="text-right">${money(v.valor_frete)}${v.frete_confirmado ? '' : ' <span class="text-muted text-small">(est.)</span>'}</td>
              <td class="text-right value-money">${money(v.valor_liquido)}</td>
            </tr>
          `).join('') || '<tr><td colspan="8" class="text-muted">Sem vendas.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
};

// ============ FINANCEIRO ============
routes.financeiro = async () => {
  const per = periodoDoMes(DASHBOARD_STATE.offset);
  const qs = `?de=${per.de}&ate=${per.ate}`;

  const [resumo, adsResumo, lancamentos] = await Promise.all([
    api('api/financeiro/resumo' + qs),
    api('api/ads/resumo' + qs).catch(() => ({ totais: { gasto_total: 0 } })),
    api('api/financeiro/lancamentos' + qs),
  ]);

  const v = resumo.vendas || { totais: {}, cmv: 0, lucro_bruto: 0, por_canal: [] };
  const t = v.totais || {};
  const adsGasto = (adsResumo.totais || {}).gasto_total || 0;

  // Breakdown automatico
  const entradaVendas = t.receita_liquida || 0; // vendas ja liquidas do fee ML e frete
  const outrasReceitas = resumo.entradas || 0;   // lancamentos manuais de entrada
  const saidaTaxasML = t.taxas_ml || 0;
  const saidaFreteVendas = t.frete_pago || 0;
  const saidaCMV = v.cmv || 0;
  const saidaAds = adsGasto;
  const saidasManuais = resumo.saidas || 0;      // inclui compra fornecedor, frete coleta, custos fixos

  const totalEntradas = entradaVendas + outrasReceitas;
  // saidasManuais ja inclui Ads (via lancamentos automaticos), Bocao (frete coleta), Oliver e custos fixos
  const totalSaidas = saidasManuais + saidaCMV; // CMV nao esta em lancamentos, adicionar
  const lucroLiquido = totalEntradas - totalSaidas;

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Financeiro</h2>
      <div class="actions" style="display:flex;gap:.5rem;align-items:center">
        <button id="btnPrevMes" class="btn-secondary">‹</button>
        <span style="min-width:180px;text-align:center;font-weight:600;text-transform:capitalize">${per.label}</span>
        <button id="btnNextMes" class="btn-secondary" ${DASHBOARD_STATE.offset >= 0 ? 'disabled' : ''}>›</button>
        <button id="btnMesAtual" class="btn-secondary" style="margin-left:.5rem">Mes atual</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi ok">
        <div class="kpi-label">Total de entradas</div>
        <div class="kpi-value">${money(totalEntradas)}</div>
        <div class="kpi-sub">vendas liquidas + manuais</div>
      </div>
      <div class="kpi warn">
        <div class="kpi-label">Total de saidas</div>
        <div class="kpi-value">${money(totalSaidas)}</div>
        <div class="kpi-sub">ads + compras + custos fixos</div>
      </div>
      <div class="kpi ${lucroLiquido >= 0 ? 'ok' : 'warn'}">
        <div class="kpi-label">Lucro liquido do mes</div>
        <div class="kpi-value">${money(lucroLiquido)}</div>
        <div class="kpi-sub">entradas − saidas</div>
      </div>
    </div>

    <details class="accordion" open>
      <summary>
        <span>📥 Entradas — breakdown</span>
        <span class="summary-info">${money(totalEntradas)}</span>
      </summary>
      <div class="accordion-body">
        <table>
          <thead><tr><th>Origem</th><th>Descricao</th><th class="text-right">Valor</th></tr></thead>
          <tbody>
            ${v.por_canal.map(c => `
              <tr>
                <td><span class="badge ${badgeCanal(c.canal)}">${labelCanal(c.canal)}</span></td>
                <td class="text-small">${c.qtd_vendas} vendas · bruto ${money(c.receita_bruta)} − taxas ${money(c.taxas_ml)} − frete ${money(c.frete_pago)}</td>
                <td class="text-right value-money positivo">${money(c.receita_liquida)}</td>
              </tr>
            `).join('')}
            <tr>
              <td>Outras receitas</td>
              <td class="text-small text-muted">lancamentos manuais (${resumo.entradas > 0 ? 'realizadas' : 'nenhuma'})</td>
              <td class="text-right value-money positivo">${money(outrasReceitas)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--cinza-2)">
              <td colspan="2">Total entradas</td>
              <td class="text-right value-money positivo">${money(totalEntradas)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>

    <details class="accordion" open>
      <summary>
        <span>📤 Saidas — breakdown</span>
        <span class="summary-info">${money(totalSaidas)}</span>
      </summary>
      <div class="accordion-body">
        <div class="text-small text-muted mb-1">
          Taxas ML (${money(saidaTaxasML)}) e Frete de vendas (${money(saidaFreteVendas)}) ja estao descontados dentro do liquido das vendas.
          CMV (${money(saidaCMV)}) e' o custo dos produtos vendidos no mes, adicionado abaixo.
        </div>
        <table>
          <thead><tr><th>Categoria</th><th>Descricao</th><th class="text-right">Valor</th></tr></thead>
          <tbody>
            <tr>
              <td>CMV (custo produtos vendidos)</td>
              <td class="text-small">${t.qtd || 0} vendas × custo unitario</td>
              <td class="text-right value-money negativo">${money(saidaCMV)}</td>
            </tr>
            ${resumo.por_categoria.filter(pc => pc.tipo === 'SAIDA').map(pc => `
              <tr>
                <td>${pc.categoria === 'OUTRA_DESPESA' ? 'Mercado Ads + outros' : pc.categoria}</td>
                <td class="text-small">${pc.qtd} lancamento${pc.qtd === 1 ? '' : 's'}</td>
                <td class="text-right value-money negativo">${money(pc.total)}</td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="text-muted">Sem lancamentos.</td></tr>'}
          </tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--cinza-2)">
              <td colspan="2">Total saidas</td>
              <td class="text-right value-money negativo">${money(totalSaidas)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>💵 Novo lancamento manual</span>
        <span class="summary-info">clique para expandir</span>
      </summary>
      <div class="accordion-body">
        <form id="formLanc" class="form-grid">
          <label>Tipo <select name="tipo" required><option value="ENTRADA">Entrada</option><option value="SAIDA">Saida</option></select></label>
          <label>Categoria <select name="categoria" required>
            <option>VENDA</option><option>TAXA_CANAL</option><option>FRETE</option>
            <option>COMPRA_FORNECEDOR</option><option>IMPOSTO</option><option>CUSTO_FIXO</option>
            <option>OUTRA_RECEITA</option><option>OUTRA_DESPESA</option>
          </select></label>
          <label>Descricao <input name="descricao" required /></label>
          <label>Valor <input name="valor" type="number" step="0.01" required /></label>
          <label>Data <input name="data" type="date" required value="${new Date().toISOString().slice(0,10)}" /></label>
          <label>&nbsp;<button type="submit" class="btn-primary">Lancar</button></label>
        </form>
      </div>
    </details>

    <details class="accordion" open>
      <summary>
        <span>📋 Lancamentos do mes</span>
        <span class="summary-info">${lancamentos.length} lancamentos</span>
      </summary>
      <div class="accordion-body">
        <table>
          <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descricao</th><th>Status</th><th class="text-right">Valor</th></tr></thead>
          <tbody>
            ${lancamentos.map(l => `
              <tr>
                <td>${fmtDate(l.data)}</td>
                <td>${l.tipo}</td>
                <td>${l.categoria}</td>
                <td>${l.descricao}</td>
                <td>${l.status}</td>
                <td class="text-right value-money ${l.tipo === 'SAIDA' ? 'negativo' : 'positivo'}">${l.tipo === 'SAIDA' ? '-' : '+'}${money(l.valor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="6" class="text-muted">Sem lancamentos manuais no periodo.</td></tr>'}
          </tbody>
        </table>
      </div>
    </details>
  `;
  $('#btnPrevMes').addEventListener('click', () => { DASHBOARD_STATE.offset--; routes.financeiro(); });
  $('#btnNextMes').addEventListener('click', () => {
    if (DASHBOARD_STATE.offset < 0) { DASHBOARD_STATE.offset++; routes.financeiro(); }
  });
  $('#btnMesAtual').addEventListener('click', () => { DASHBOARD_STATE.offset = 0; routes.financeiro(); });
  const formEl = $('#formLanc');
  if (formEl) formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    await api('api/financeiro/lancamentos', { method: 'POST', body: JSON.stringify(body) });
    routes.financeiro();
  });
};

// ============ CUSTOS FIXOS RECORRENTES ============
routes.recorrentes = async () => {
  const rows = await api('api/financeiro/recorrentes');
  $('#content').innerHTML = `
    <div class="page-header"><h2>Custos fixos recorrentes</h2></div>
    <div class="card">
      <h3>Nova conta recorrente</h3>
      <form id="formRec" class="form-grid">
        <label>Descricao <input name="descricao" required /></label>
        <label>Categoria <select name="categoria" required>
          <option>CUSTO_FIXO</option><option>IMPOSTO</option><option>OUTRA_DESPESA</option>
        </select></label>
        <label>Valor <input name="valor" type="number" step="0.01" required /></label>
        <label>Dia venc. <input name="dia_vencimento" type="number" min="1" max="31" required /></label>
        <label>&nbsp;<button type="submit" class="btn-primary">Adicionar</button></label>
      </form>
    </div>
    <div class="card">
      <h3>Contas cadastradas</h3>
      <table>
        <thead><tr><th>Descricao</th><th>Categoria</th><th class="text-right">Valor</th><th class="text-right">Dia venc.</th><th>Ativo</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.descricao}</td>
              <td>${r.categoria}</td>
              <td class="text-right value-money">${money(r.valor)}</td>
              <td class="text-right">${r.dia_vencimento}</td>
              <td>${r.ativo ? 'sim' : 'nao'}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="text-muted">Nenhuma conta recorrente.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  $('#formRec').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    await api('api/financeiro/recorrentes', { method: 'POST', body: JSON.stringify(body) });
    routes.recorrentes();
  });
};

// ============ SYNC ============
routes.sync = async () => {
  const status = await api('api/sync/status');
  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Sincronizacao de canais</h2>
      <div class="actions">
        <button id="btnSyncML" class="btn-primary">Sync ML agora</button>
        <button id="btnSyncSite" class="btn-primary">Sync Site agora</button>
        <button id="btnSyncMp" class="btn-primary">Sync MP agora</button>
      </div>
    </div>
    <div class="card">
      <h3>Vendas por canal</h3>
      <table>
        <thead><tr><th>Canal</th><th class="text-right">Total</th><th>Ultima venda</th></tr></thead>
        <tbody>
          ${status.por_canal.map(c => `
            <tr>
              <td><span class="badge ${badgeCanal(c.canal)}">${labelCanal(c.canal)}</span></td>
              <td class="text-right">${c.total}</td>
              <td>${fmtDateTime(c.ultima_venda)}</td>
            </tr>
          `).join('') || '<tr><td colspan="3" class="text-muted">Nenhuma venda importada ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Ultimos logs</h3>
      <table>
        <thead><tr><th>Quando</th><th>Canal</th><th>Tipo</th><th>Status</th><th class="text-right">Itens</th><th>Mensagem</th></tr></thead>
        <tbody>
          ${status.ultimos_logs.map(l => `
            <tr>
              <td>${fmtDateTime(l.criado_em)}</td>
              <td>${l.canal}</td>
              <td>${l.tipo}</td>
              <td><span class="badge ${l.status === 'ok' ? 'ok' : 'critico'}">${l.status}</span></td>
              <td class="text-right">${l.itens_processados || 0}</td>
              <td class="text-muted text-small">${l.mensagem || ''}</td>
            </tr>
          `).join('') || '<tr><td colspan="6" class="text-muted">Sem logs ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  $('#btnSyncML').addEventListener('click', async () => {
    try {
      const r = await api('api/sync/mercadolivre', { method: 'POST' });
      alert(`ML: ${r.processados} pedidos processados`);
      routes.sync();
    } catch (err) {
      if (err.message.includes('nao autenticado')) {
        if (confirm('ML nao autenticado. Autorizar agora?')) {
          window.location.href = 'api/ml/authorize';
        }
      } else alert('Erro: ' + err.message);
    }
  });
  $('#btnSyncSite').addEventListener('click', async () => {
    try {
      const r = await api('api/sync/site', { method: 'POST' });
      alert(`Site: ${r.processados} pedidos processados`);
      routes.sync();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  });
  $('#btnSyncMp').addEventListener('click', async () => {
    try {
      const r = await api('api/sync/mercadopago', { method: 'POST' });
      alert(`Mercado Pago: ${r.processados} pagamentos processados`);
      routes.sync();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  });
};

// ============ MERCADO ADS (POR ANUNCIO) ============
routes.ads = async () => {
  const per = periodoDoMes(DASHBOARD_STATE.offset);
  const data = await api(`api/ads/items?de=${per.de}&ate=${per.ate}`);
  const t = data.totais || {};
  const items = data.items || [];

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Mercado Ads por anuncio (${per.label})</h2>
      <div class="actions">
        <button id="btnSyncAds" class="btn-primary">Sync agora</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi warn">
        <div class="kpi-label">Gasto total no mes</div>
        <div class="kpi-value">${money(t.gasto)}</div>
        <div class="kpi-sub">${t.qtd || 0} anuncios ativos</div>
      </div>
      <div class="kpi ok">
        <div class="kpi-label">Vendas geradas</div>
        <div class="kpi-value">${money(t.total_amount)}</div>
        <div class="kpi-sub">direto: ${money(t.direct_amount)}</div>
      </div>
      <div class="kpi ${(t.roas || 0) >= 4 ? 'ok' : 'warn'}">
        <div class="kpi-label">ROAS medio</div>
        <div class="kpi-value">${(t.roas || 0).toFixed(2)}x</div>
        <div class="kpi-sub">ACOS ${(t.acos_geral || 0).toFixed(1)}%</div>
      </div>
    </div>

    <div class="card mt-1">
      <h3>Anuncios (${items.length}) — ordenado por maior gasto</h3>
      <div class="text-small text-muted mb-1">
        Clique no titulo do anuncio para abrir no Mercado Livre.
      </div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Anuncio</th>
            <th>SKU</th>
            <th>Campanha</th>
            <th class="text-right">Gasto</th>
            <th class="text-right">Cliques</th>
            <th class="text-right">Impressoes</th>
            <th class="text-right">CPC</th>
            <th class="text-right">CTR</th>
            <th class="text-right">Vendas</th>
            <th class="text-right">ROAS</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => {
            const roas = it.cost > 0 ? (it.total_amount || 0) / it.cost : 0;
            const roasClass = roas >= 4 ? 'positivo' : roas > 0 ? '' : 'negativo';
            return `
            <tr>
              <td>${it.thumbnail ? `<img src="${it.thumbnail}" style="width:40px;height:40px;border-radius:4px;object-fit:cover" />` : ''}</td>
              <td>
                ${it.permalink ? `<a href="${it.permalink}" target="_blank" style="color:var(--texto);text-decoration:none">${(it.title || '').substring(0,60)}${(it.title || '').length > 60 ? '…' : ''}</a>` : (it.title || '')}
                <div class="text-small text-muted"><code>${it.item_id}</code></div>
              </td>
              <td>${it.sku ? `<code>${it.sku}</code>` : '<span class="text-muted">-</span>'}</td>
              <td class="text-small">${it.campanha_nome || '-'}</td>
              <td class="text-right value-money negativo">${money(it.cost)}</td>
              <td class="text-right">${it.clicks || 0}</td>
              <td class="text-right text-muted">${(it.prints || 0).toLocaleString('pt-BR')}</td>
              <td class="text-right">${money(it.cpc)}</td>
              <td class="text-right">${(it.ctr || 0).toFixed(2)}%</td>
              <td class="text-right value-money positivo">${money(it.total_amount)}</td>
              <td class="text-right value-money ${roasClass}">${it.cost > 0 ? roas.toFixed(2) + 'x' : '-'}</td>
            </tr>
            `;
          }).join('') || '<tr><td colspan="11" class="text-muted">Nenhum anuncio com metricas ainda. Roda Sync agora.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  $('#btnSyncAds').addEventListener('click', async () => {
    try {
      const r = await api(`api/sync/mercadoads?de=${per.de}&ate=${per.ate}`, { method: 'POST' });
      alert(`Ads sincronizados: ${r.campanhas?.processados || 0} campanhas + ${r.items?.processados || 0} anuncios`);
      routes.ads();
    } catch (err) { alert('Erro: ' + err.message); }
  });
};

// ============ MERCADO PAGO ============
routes.mp = async () => {
  const per = periodoDoMes(DASHBOARD_STATE.offset);
  const [saldo, movs] = await Promise.all([
    api('api/mp/saldo'),
    api(`api/mp/movimentos?de=${per.de}&ate=${per.ate}&limit=300`),
  ]);
  const s = saldo.saldo;
  const prox = saldo.proximas_liberacoes || [];

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Mercado Pago</h2>
      <div class="actions">
        <button id="btnSyncMp" class="btn-primary">Sync agora</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi ok">
        <div class="kpi-label">Saldo disponivel (estimado)</div>
        <div class="kpi-value">${money(s.disponivel_estimado)}</div>
        <div class="kpi-sub">liberado ate hoje</div>
      </div>
      <div class="kpi warn">
        <div class="kpi-label">A liberar</div>
        <div class="kpi-value">${money(s.a_liberar)}</div>
        <div class="kpi-sub">${s.a_liberar_qtd} pagamento${s.a_liberar_qtd === 1 ? '' : 's'} aguardando</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Total no MP</div>
        <div class="kpi-value">${money(s.total)}</div>
        <div class="kpi-sub">disponivel + a liberar</div>
      </div>
    </div>

    ${prox.length > 0 ? `
    <div class="card mt-1">
      <h3>Proximas liberacoes (45 dias)</h3>
      <table>
        <thead><tr><th>Data</th><th class="text-right">Qtd</th><th class="text-right">Valor liquido</th></tr></thead>
        <tbody>
          ${prox.map(pl => `
            <tr>
              <td>${fmtDate(pl.data)}</td>
              <td class="text-right">${pl.qtd}</td>
              <td class="text-right value-money positivo">${money(pl.valor)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <div class="card mt-1">
      <h3>Movimentos do mes (${per.label}) — ${movs.movimentos.length}</h3>
      <div class="text-small text-muted mb-1">Bruto: ${money(movs.resumo.bruto)} · Taxas MP: ${money(movs.resumo.taxas)} · Liquido: ${money(movs.resumo.liquido)}</div>
      <table>
        <thead><tr><th>Data</th><th>Status</th><th>Descricao</th><th>Pagador</th><th class="text-right">Bruto</th><th class="text-right">Taxa MP</th><th class="text-right">Liquido</th><th>Libera em</th></tr></thead>
        <tbody>
          ${movs.movimentos.map(m => `
            <tr>
              <td>${fmtDate(m.date_created)}</td>
              <td><span class="badge ${m.status === 'approved' ? 'ok' : m.status === 'refunded' || m.status === 'cancelled' ? 'critico' : 'warn'}">${m.status}</span></td>
              <td class="text-small">${m.descricao || m.external_reference || '-'}</td>
              <td class="text-small">${m.payer_nome || m.payer_email || '-'}</td>
              <td class="text-right value-money">${money(m.transaction_amount)}</td>
              <td class="text-right value-money negativo">${money(m.taxa_mp)}</td>
              <td class="text-right value-money positivo">${money(m.net_received_amount)}</td>
              <td class="text-small text-muted">${m.money_release_date ? fmtDate(m.money_release_date) : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="8" class="text-muted">Sem movimentos no periodo. Rode "Sync agora" se ainda nao sincronizou.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  $('#btnSyncMp').addEventListener('click', async () => {
    try {
      const r = await api('api/sync/mercadopago', { method: 'POST' });
      alert(`MP: ${r.processados} pagamentos processados em ${r.ms}ms`);
      routes.mp();
    } catch (err) { alert('Erro: ' + err.message); }
  });
};

// ============ PEDIDOS DE COMPRA ============
const PEDIDOS_STATE = { detalheId: null };

routes.pedidos = async () => {
  if (PEDIDOS_STATE.detalheId) {
    await renderPedidoDetalhe(PEDIDOS_STATE.detalheId);
    return;
  }

  const [pedidos, fornecedores, cfg] = await Promise.all([
    api('api/pedidos-compra'),
    api('api/pedidos-compra/fornecedores'),
    api('api/config'),
  ]);

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Pedidos de compra</h2>
      <div class="actions">
        <button id="btnNovoPedido" class="btn-primary">+ Novo pedido</button>
      </div>
    </div>

    <div class="card">
      <table>
        <thead><tr><th>Pedido</th><th>Data</th><th>Fornecedor</th><th class="text-right">Itens</th><th class="text-right">Pecas</th><th class="text-right">Valor</th><th>Status</th><th>Coleta</th><th style="width:200px"></th></tr></thead>
        <tbody>
          ${pedidos.map(p => `
            <tr>
              <td><strong>Pedido #${p.id}</strong></td>
              <td>${fmtDate(p.data_pedido)}</td>
              <td>${p.fornecedor_nome}</td>
              <td class="text-right">${p.itens_count}</td>
              <td class="text-right">${p.total_pecas || 0}</td>
              <td class="text-right value-money">${money(p.valor_total)}</td>
              <td>${badgeStatusPedido(p.status)}</td>
              <td class="text-small">${p.coletado_por ? (p.coletado_por === 'RAFAEL_BOCAO' ? 'Rafael Bocao' : p.coletado_por === 'LEANDRO' ? 'Leandro' : (p.coletado_por_nome || 'Outro')) + (p.custo_coleta > 0 ? ' · ' + money(p.custo_coleta) : '') : '-'}</td>
              <td>
                <button class="btn-secondary" data-abrir="${p.id}">Abrir</button>
                ${p.status === 'aberto' ? `<button class="btn-secondary" data-fechar="${p.id}">Fechar</button>` : ''}
                ${p.status === 'fechado' ? `<button class="btn-secondary" data-reabrir="${p.id}">Reabrir</button>` : ''}
                ${['aberto', 'fechado'].includes(p.status) ? `<button class="btn-primary" data-receber="${p.id}">Receber</button>` : ''}
              </td>
            </tr>
          `).join('') || '<tr><td colspan="9" class="text-muted">Nenhum pedido ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  $('#btnNovoPedido').addEventListener('click', async () => {
    try {
      const r = await api('api/pedidos-compra', {
        method: 'POST',
        body: JSON.stringify({
          fornecedor_id: fornecedores[0].id,
          data_pedido: new Date().toISOString().slice(0, 10),
          itens: [{ produto_id: null }], // vamos criar pedido "vazio" — mas API precisa 1 item
        }),
      }).catch(async () => {
        // Se falhar por precisar de item, cria diferente
        return null;
      });
      // Alternativa: criar pedido vazio via importar-historico com status=aberto
      const semItem = await api('api/pedidos-compra/importar-historico', {
        method: 'POST',
        body: JSON.stringify({
          fornecedor_id: fornecedores[0].id,
          data_pedido: new Date().toISOString().slice(0, 10),
          status: 'aberto',
          itens: [],
        }),
      });
      PEDIDOS_STATE.detalheId = semItem.id;
      routes.pedidos();
    } catch (err) { alert('Erro: ' + err.message); }
  });

  $$('[data-abrir]').forEach(b => b.addEventListener('click', () => {
    PEDIDOS_STATE.detalheId = Number(b.dataset.abrir);
    routes.pedidos();
  }));

  $$('[data-fechar]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Fechar pedido #' + b.dataset.fechar + '? Depois de fechado ele fica aguardando entrega.')) return;
    try {
      await api(`api/pedidos-compra/${b.dataset.fechar}/fechar`, { method: 'POST' });
      routes.pedidos();
    } catch (err) { alert('Erro: ' + err.message); }
  }));

  $$('[data-reabrir]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api(`api/pedidos-compra/${b.dataset.reabrir}/reabrir`, { method: 'POST' });
      routes.pedidos();
    } catch (err) { alert('Erro: ' + err.message); }
  }));

  $$('[data-receber]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pedidoId = btn.dataset.receber;
      const custoRafael = Number(cfg.custo_coleta_rafael_bocao || 110);
      const opcaoTxt = 'Quem buscou?\n1 = Leandro (gratis)\n2 = Rafael Bocao (' + money(custoRafael) + ')\n3 = Outro (informar nome + custo)';
      const opcao = prompt(opcaoTxt, '2');
      if (!opcao) return;
      let coletado_por, coletado_por_nome, custo_coleta;
      if (opcao === '1') { coletado_por = 'LEANDRO'; }
      else if (opcao === '2') { coletado_por = 'RAFAEL_BOCAO'; }
      else if (opcao === '3') {
        coletado_por = 'OUTRO';
        coletado_por_nome = prompt('Nome do transportador:');
        if (!coletado_por_nome) return;
        custo_coleta = Number(prompt('Custo da coleta (R$):'));
        if (!custo_coleta && custo_coleta !== 0) return;
      } else { alert('Opcao invalida'); return; }
      const dataRec = prompt('Data de recebimento:', new Date().toISOString().slice(0,10));
      try {
        const r = await api(`api/pedidos-compra/${pedidoId}/receber`, {
          method: 'POST',
          body: JSON.stringify({ coletado_por, coletado_por_nome, custo_coleta, data_recebimento: dataRec }),
        });
        alert('Pedido recebido! Estoque atualizado. Custo coleta: ' + money(r.custo_coleta));
        routes.pedidos();
      } catch (err) { alert('Erro: ' + err.message); }
    });
  });
};

function badgeStatusPedido(status) {
  const map = {
    aberto: '<span class="badge warn">em aberto</span>',
    fechado: '<span class="badge canal-ml">fechado (aguardando)</span>',
    recebido: '<span class="badge ok">recebido</span>',
    cancelado: '<span class="badge critico">cancelado</span>',
  };
  return map[status] || `<span class="badge">${status}</span>`;
}

async function renderPedidoDetalhe(id) {
  const [pedido, produtos, fornecedores] = await Promise.all([
    api('api/pedidos-compra/' + id),
    api('api/produtos'),
    api('api/pedidos-compra/fornecedores'),
  ]);
  const editavel = ['aberto', 'fechado'].includes(pedido.status);

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Pedido #${pedido.id} — ${pedido.fornecedor_nome}</h2>
      <div class="actions">
        <button class="btn-secondary" id="btnVoltar">← Voltar</button>
        ${editavel ? `<button class="btn-primary" id="btnAddItem">+ Adicionar item</button>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="form-grid">
        <label>Fornecedor
          <select id="edtFornecedor" ${editavel ? '' : 'disabled'}>
            ${fornecedores.map(f => `<option value="${f.id}" ${f.id === pedido.fornecedor_id ? 'selected' : ''}>${f.nome}</option>`).join('')}
          </select>
        </label>
        <label>Data do pedido <input type="date" id="edtData" value="${pedido.data_pedido}" ${editavel ? '' : 'disabled'} /></label>
        <label>Status ${badgeStatusPedido(pedido.status)}</label>
        <label>Observacao <input id="edtObs" value="${pedido.observacao || ''}" ${editavel ? '' : 'disabled'} /></label>
      </div>
      ${editavel ? `<button class="btn-secondary mt-1" id="btnSalvarCab">Salvar cabecalho</button>` : ''}
    </div>

    <div class="card">
      <h3>Itens (${pedido.itens.length})</h3>
      <table>
        <thead><tr>
          <th>Status</th><th>Produto</th>
          <th class="text-right">Qtd total</th>
          <th class="text-right">Ja retirado</th>
          <th class="text-right">Falta</th>
          <th class="text-right">Custo unit.</th>
          <th class="text-right">Subtotal</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${pedido.itens.map(it => {
            const jaRec = it.qtd_ja_recebida || 0;
            const aReceber = it.quantidade - jaRec;
            let statusIcon, statusLabel, statusClass;
            if (jaRec === 0) { statusIcon = '⚪'; statusLabel = 'Aguardando'; statusClass = 'warn'; }
            else if (jaRec >= it.quantidade) { statusIcon = '🟢'; statusLabel = 'Retirado'; statusClass = 'ok'; }
            else { statusIcon = '🟡'; statusLabel = 'Parcial'; statusClass = 'warn'; }
            return `
            <tr ${jaRec >= it.quantidade ? 'style="opacity:0.6"' : ''}>
              <td><span class="badge ${statusClass}">${statusIcon} ${statusLabel}</span></td>
              <td>${it.sku ? `<code>${it.sku}</code> ` : ''}${it.produto_nome}</td>
              <td class="text-right">
                ${editavel ? `<input type="number" min="1" style="width:70px;text-align:right" value="${it.quantidade}" data-item="${it.id}" data-field="quantidade" />` : it.quantidade}
              </td>
              <td class="text-right" style="white-space:nowrap">
                ${editavel ? `<input type="number" min="0" max="${it.quantidade}" style="width:60px;text-align:right" value="${jaRec}" data-item="${it.id}" data-jarec="1" title="Quantidade ja retirada antes" />
                <button class="btn-secondary" style="padding:2px 6px;font-size:.75rem;margin-left:4px" data-tudo="${it.id}" data-qtd="${it.quantidade}" title="Marcar tudo como retirado">✓ tudo</button>
                ${jaRec > 0 ? `<button class="btn-secondary" style="padding:2px 6px;font-size:.75rem;margin-left:2px" data-zerar="${it.id}" title="Zerar retirada">↺</button>` : ''}` : jaRec}
              </td>
              <td class="text-right ${aReceber === 0 ? 'text-muted' : 'value-money'}">${aReceber}</td>
              <td class="text-right">
                ${editavel ? `<input type="number" step="0.01" style="width:100px;text-align:right" value="${it.custo_unitario}" data-item="${it.id}" data-field="custo_unitario" />` : money(it.custo_unitario)}
              </td>
              <td class="text-right value-money">${money(it.quantidade * it.custo_unitario)}</td>
              <td>${editavel ? `<button class="btn-secondary" data-remitem="${it.id}">x</button>` : ''}</td>
            </tr>
          `;}).join('') || '<tr><td colspan="8" class="text-muted">Sem itens.</td></tr>'}
        </tbody>
        <tfoot>
          <tr style="font-weight:700;border-top:2px solid var(--cinza-2)">
            <td colspan="2">${pedido.itens.reduce((s, it) => s + it.quantidade, 0)} pecas total</td>
            <td class="text-right"></td>
            <td class="text-right text-small text-muted">${pedido.itens.reduce((s, it) => s + (it.qtd_ja_recebida||0), 0)} ja retiradas</td>
            <td class="text-right text-small text-muted">${pedido.itens.reduce((s, it) => s + (it.quantidade - (it.qtd_ja_recebida||0)), 0)} a receber</td>
            <td colspan="1"></td>
            <td class="text-right value-money">${money(pedido.valor_total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      ${editavel && pedido.itens.some(it => (it.qtd_ja_recebida||0) < it.quantidade) ? `
      <div class="mt-1" style="display:flex;gap:.5rem;justify-content:flex-end">
        <button class="btn-secondary" id="btnMarcarTudoRetirado">✓ Marcar todos os itens como retirados</button>
      </div>` : ''}
    </div>
  `;

  $('#btnVoltar').addEventListener('click', () => { PEDIDOS_STATE.detalheId = null; routes.pedidos(); });

  if (editavel) {
    $('#btnSalvarCab').addEventListener('click', async () => {
      try {
        await api('api/pedidos-compra/' + id, {
          method: 'PATCH',
          body: JSON.stringify({
            fornecedor_id: Number($('#edtFornecedor').value),
            data_pedido: $('#edtData').value,
            observacao: $('#edtObs').value || null,
          }),
        });
        alert('Cabecalho salvo');
      } catch (err) { alert('Erro: ' + err.message); }
    });

    $('#btnAddItem').addEventListener('click', () => {
      const container = document.createElement('div');
      container.className = 'card';
      container.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;min-width:500px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3)';
      container.innerHTML = `
        <h3>Adicionar item ao pedido</h3>
        <div class="form-grid">
          <label>Produto
            <select id="addProduto" style="width:100%">
              <option value="">-- selecione --</option>
              ${produtos.map(p => `<option value="${p.id}" data-custo="${p.custo_unitario}">${p.sku} - ${p.nome}</option>`).join('')}
            </select>
          </label>
          <label>Quantidade <input type="number" id="addQtd" min="1" value="1" /></label>
          <label>Custo unit. (R$) <input type="number" step="0.01" id="addCusto" value="280" /></label>
        </div>
        <div class="mt-1" style="display:flex;gap:.5rem;justify-content:flex-end">
          <button class="btn-secondary" id="addCancel">Cancelar</button>
          <button class="btn-primary" id="addSalvar">Adicionar</button>
        </div>
      `;
      document.body.appendChild(container);
      const back = document.createElement('div');
      back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99';
      document.body.appendChild(back);
      const fechar = () => { container.remove(); back.remove(); };
      back.addEventListener('click', fechar);
      container.querySelector('#addCancel').addEventListener('click', fechar);
      container.querySelector('#addProduto').addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        if (opt && opt.dataset.custo) container.querySelector('#addCusto').value = opt.dataset.custo;
      });
      container.querySelector('#addSalvar').addEventListener('click', async () => {
        const produto_id = Number(container.querySelector('#addProduto').value);
        const quantidade = Number(container.querySelector('#addQtd').value);
        const custo_unitario = Number(container.querySelector('#addCusto').value);
        if (!produto_id || !quantidade || !custo_unitario) { alert('Preencha todos'); return; }
        try {
          await api(`api/pedidos-compra/${id}/itens`, {
            method: 'POST',
            body: JSON.stringify({ produto_id, quantidade, custo_unitario }),
          });
          fechar();
          renderPedidoDetalhe(id);
        } catch (err) { alert('Erro: ' + err.message); }
      });
    });

    $$('[data-item][data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const itemId = input.dataset.item;
        const field = input.dataset.field;
        const value = Number(input.value);
        try {
          await api(`api/pedidos-compra/${id}/itens/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify({ [field]: value }),
          });
          renderPedidoDetalhe(id);
        } catch (err) { alert('Erro: ' + err.message); }
      });
    });

    $$('[data-item][data-jarec]').forEach(input => {
      input.addEventListener('change', async () => {
        const itemId = input.dataset.item;
        const v = Number(input.value);
        try {
          await api(`api/pedidos-compra/${id}/itens/${itemId}/ja-recebida`, {
            method: 'PATCH',
            body: JSON.stringify({ qtd_ja_recebida: v }),
          });
          renderPedidoDetalhe(id);
        } catch (err) { alert('Erro: ' + err.message); }
      });
    });

    $$('[data-tudo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.dataset.tudo;
        const qtd = Number(btn.dataset.qtd);
        try {
          await api(`api/pedidos-compra/${id}/itens/${itemId}/ja-recebida`, {
            method: 'PATCH',
            body: JSON.stringify({ qtd_ja_recebida: qtd }),
          });
          renderPedidoDetalhe(id);
        } catch (err) { alert('Erro: ' + err.message); }
      });
    });

    $$('[data-zerar]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.dataset.zerar;
        try {
          await api(`api/pedidos-compra/${id}/itens/${itemId}/ja-recebida`, {
            method: 'PATCH',
            body: JSON.stringify({ qtd_ja_recebida: 0 }),
          });
          renderPedidoDetalhe(id);
        } catch (err) { alert('Erro: ' + err.message); }
      });
    });

    const btnMarcarTudo = $('#btnMarcarTudoRetirado');
    if (btnMarcarTudo) btnMarcarTudo.addEventListener('click', async () => {
      if (!confirm('Marcar TODOS os itens do pedido como ja retirados? Isso significa que voce ja recebeu tudo fisicamente.')) return;
      try {
        for (const it of pedido.itens) {
          if ((it.qtd_ja_recebida || 0) < it.quantidade) {
            await api(`api/pedidos-compra/${id}/itens/${it.id}/ja-recebida`, {
              method: 'PATCH',
              body: JSON.stringify({ qtd_ja_recebida: it.quantidade }),
            });
          }
        }
        renderPedidoDetalhe(id);
      } catch (err) { alert('Erro: ' + err.message); }
    });

    $$('[data-remitem]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remover item?')) return;
      try {
        await api(`api/pedidos-compra/${id}/itens/${b.dataset.remitem}`, { method: 'DELETE' });
        renderPedidoDetalhe(id);
      } catch (err) { alert('Erro: ' + err.message); }
    }));
  }
}

// ============ INVENTARIO ============
routes.inventario = async () => {
  const inventarios = await api('api/inventario');
  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Inventario</h2>
      <div class="actions">
        <button id="btnNovaContagem" class="btn-primary">Nova contagem</button>
      </div>
    </div>
    <div class="card">
      <h3>Contagens (${inventarios.length})</h3>
      <table>
        <thead><tr><th>#</th><th>Data</th><th>Feito por</th><th class="text-right">SKUs</th><th class="text-right">Contados</th><th class="text-right">Diferencas</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${inventarios.map(inv => `
            <tr>
              <td>#${inv.id}</td>
              <td>${fmtDate(inv.data_contagem)}</td>
              <td>${inv.usuario_nome || '-'}</td>
              <td class="text-right">${inv.total_itens}</td>
              <td class="text-right">${inv.contados}</td>
              <td class="text-right">${inv.abs_diferencas || 0}</td>
              <td><span class="badge ${inv.status === 'finalizado' ? 'ok' : inv.status === 'cancelado' ? 'critico' : 'warn'}">${inv.status}</span></td>
              <td><button class="btn-secondary" data-abrir="${inv.id}">${inv.status === 'aberto' ? 'Contar' : 'Ver'}</button></td>
            </tr>
          `).join('') || '<tr><td colspan="8" class="text-muted">Nenhuma contagem ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  $('#btnNovaContagem').addEventListener('click', async () => {
    const obs = prompt('Observacao (opcional):', '');
    try {
      const r = await api('api/inventario', { method: 'POST', body: JSON.stringify({ observacao: obs || null }) });
      window.location.hash = '#/inventario/' + r.id;
    } catch (err) { alert('Erro: ' + err.message); }
  });

  $$('[data-abrir]').forEach(b => {
    b.addEventListener('click', () => { window.location.hash = '#/inventario/' + b.dataset.abrir; });
  });
};

routes['inventario/:id'] = null; // placeholder; router faz split

// Route handler que trata #/inventario/N
const _originalRoute = route;
window.route = function () {
  const hash = window.location.hash.replace('#/', '') || 'dashboard';
  if (hash.startsWith('inventario/')) {
    const id = hash.split('/')[1];
    $$('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.route === 'inventario'));
    detalheInventario(Number(id)).catch(err => {
      $('#content').innerHTML = `<div class="card"><h3>Erro</h3><p>${err.message}</p></div>`;
    });
    return;
  }
  _originalRoute();
};
window.addEventListener('hashchange', window.route);

async function detalheInventario(id) {
  const inv = await api('api/inventario/' + id);
  const readonly = inv.status !== 'aberto';
  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Inventario #${inv.id} - ${fmtDate(inv.data_contagem)}</h2>
      <div class="actions">
        <a href="#/inventario" class="btn-secondary">Voltar</a>
        ${!readonly ? `<button id="btnFinalizar" class="btn-primary">Finalizar contagem</button>` : ''}
      </div>
    </div>
    <div class="card">
      <p class="text-muted">Status: <span class="badge ${inv.status === 'finalizado' ? 'ok' : inv.status === 'cancelado' ? 'critico' : 'warn'}">${inv.status}</span> · Feito por: ${inv.usuario_nome || '-'}</p>
      <p class="text-muted">${inv.observacao || ''}</p>
      <table>
        <thead><tr><th>SKU</th><th>Produto</th><th class="text-right">Sistema</th><th class="text-right">Contado</th><th class="text-right">Diferenca</th></tr></thead>
        <tbody>
          ${inv.itens.map(it => `
            <tr>
              <td><code>${it.sku}</code></td>
              <td>${it.produto_nome}</td>
              <td class="text-right value-money">${it.qtd_antes}</td>
              <td class="text-right">
                ${readonly
                  ? (it.qtd_contada != null ? it.qtd_contada : '<span class="text-muted">-</span>')
                  : `<input type="number" min="0" style="width:80px;text-align:right" value="${it.qtd_contada != null ? it.qtd_contada : ''}" data-item="${it.id}" />`}
              </td>
              <td class="text-right value-money ${it.diferenca > 0 ? 'positivo' : it.diferenca < 0 ? 'negativo' : ''}">${it.diferenca != null ? (it.diferenca > 0 ? '+' : '') + it.diferenca : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (!readonly) {
    $$('[data-item]').forEach(input => {
      input.addEventListener('change', async () => {
        const v = Number(input.value);
        if (isNaN(v) || v < 0) return;
        try {
          await api('api/inventario/' + id + '/itens/' + input.dataset.item, {
            method: 'PATCH',
            body: JSON.stringify({ qtd_contada: v }),
          });
          detalheInventario(id);
        } catch (err) { alert('Erro: ' + err.message); }
      });
    });
    $('#btnFinalizar').addEventListener('click', async () => {
      if (!confirm('Finalizar contagem e aplicar ajustes de estoque?')) return;
      try {
        const r = await api('api/inventario/' + id + '/finalizar', { method: 'POST' });
        alert(`Contagem finalizada. ${r.ajustados} SKU(s) ajustado(s) de ${r.total_contados} contado(s).`);
        detalheInventario(id);
      } catch (err) { alert('Erro: ' + err.message); }
    });
  }
}

// ============ CONFIG ============
routes.config = async () => {
  const cfg = await api('api/config');
  $('#content').innerHTML = `
    <div class="page-header"><h2>Configuracoes</h2></div>
    <div class="card">
      <h3>Coleta de peças</h3>
      <div class="form-grid">
        <label>Custo Rafael Bocao (R$)
          <input type="number" step="0.01" id="custoRafael" value="${cfg.custo_coleta_rafael_bocao || 110}" />
        </label>
        <label>&nbsp;
          <button id="btnSalvarCfg" class="btn-primary">Salvar</button>
        </label>
      </div>
      <p class="text-muted text-small mt-1">Este valor sera usado por padrao ao receber pedidos com "Rafael Bocao" como transportador.</p>
    </div>
  `;
  $('#btnSalvarCfg').addEventListener('click', async () => {
    try {
      await api('api/config/custo_coleta_rafael_bocao', {
        method: 'PUT',
        body: JSON.stringify({ value: $('#custoRafael').value }),
      });
      alert('Salvo!');
    } catch (err) { alert('Erro: ' + err.message); }
  });
};

boot().catch(err => {
  console.error(err);
  window.location.href = 'login';
});
