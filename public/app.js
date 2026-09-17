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

  const [resumo, estoque, vendas, saldoMp, adsResumo] = await Promise.all([
    api('api/financeiro/resumo' + qs),
    api('api/estoque'),
    api('api/vendas' + qs + '&limit=10'),
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

    <h3 class="mb-1" style="color:var(--cinza-3);font-size:.85rem;text-transform:uppercase;letter-spacing:1px">Dinheiro (Mercado Livre + Mercado Pago)</h3>
    <div class="kpi-grid">
      <div class="kpi ok">
        <div class="kpi-label">Saldo MP disponivel</div>
        <div class="kpi-value">${money(mpSaldo.disponivel_estimado)}</div>
        <div class="kpi-sub">estimado</div>
      </div>
      <div class="kpi warn">
        <div class="kpi-label">MP a liberar</div>
        <div class="kpi-value">${money(mpSaldo.a_liberar)}</div>
        <div class="kpi-sub">aguardando prazo MP</div>
      </div>
      <div class="kpi ${aReceber.total_liquido > 0 ? 'ok' : ''}">
        <div class="kpi-label">A receber ML (liquido)</div>
        <div class="kpi-value">${money(aReceber.total_liquido)}</div>
        <div class="kpi-sub">${aReceber.qtd} venda${aReceber.qtd === 1 ? '' : 's'} · bruto ${money(aReceber.total_bruto)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Total a receber</div>
        <div class="kpi-value">${money(mpSaldo.total + aReceber.total_liquido)}</div>
        <div class="kpi-sub">MP total + ML liquido</div>
      </div>
    </div>

    <h3 class="mb-1 mt-1" style="color:var(--cinza-3);font-size:.85rem;text-transform:uppercase;letter-spacing:1px">Vendas do mes (${per.de} a ${per.ate})</h3>
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

    <h3 class="mb-1 mt-1" style="color:var(--cinza-3);font-size:.85rem;text-transform:uppercase;letter-spacing:1px">Fluxo de caixa</h3>
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

    <h3 class="mb-1 mt-1" style="color:var(--cinza-3);font-size:.85rem;text-transform:uppercase;letter-spacing:1px">Estoque</h3>
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

    <div class="card mt-1">
      <h3>Vendas por canal (mes)</h3>
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
    </div>

    <div class="card mt-1">
      <h3>Vendas do mes (${vendas.length})</h3>
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
          `).join('') || '<tr><td colspan="6" class="text-muted">Sem vendas no periodo.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

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
      <table>
        <thead>
          <tr>
            <th>SKU</th><th>Nome</th><th>Custo</th><th>Preco</th>
            <th class="text-right">Estoque</th><th class="text-right">Minimo</th><th>Status</th>
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
  return `
    <tr>
      <td><code>${p.sku}</code></td>
      <td>${p.nome}</td>
      <td class="value-money">${money(p.custo_unitario)}</td>
      <td class="value-money">${money(p.preco_venda)}</td>
      <td class="text-right value-money">${p.estoque_atual}</td>
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
  const resumo = await api('api/financeiro/resumo');
  const lancamentos = await api('api/financeiro/lancamentos');
  $('#content').innerHTML = `
    <div class="page-header"><h2>Financeiro</h2></div>
    <div class="kpi-grid">
      <div class="kpi ok"><div class="kpi-label">Entradas</div><div class="kpi-value">${money(resumo.entradas)}</div></div>
      <div class="kpi warn"><div class="kpi-label">Saidas</div><div class="kpi-value">${money(resumo.saidas)}</div></div>
      <div class="kpi ${resumo.saldo >= 0 ? 'ok' : 'warn'}"><div class="kpi-label">Saldo do mes</div><div class="kpi-value">${money(resumo.saldo)}</div></div>
    </div>
    <div class="card">
      <h3>Novo lancamento</h3>
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
    <div class="card">
      <h3>Lancamentos</h3>
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
          `).join('') || '<tr><td colspan="6" class="text-muted">Sem lancamentos.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  $('#formLanc').addEventListener('submit', async (e) => {
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

// ============ MERCADO ADS ============
routes.ads = async () => {
  const per = periodoDoMes(DASHBOARD_STATE.offset);
  const data = await api(`api/ads/resumo?de=${per.de}&ate=${per.ate}`);
  const t = data.totais || {};

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Mercado Ads (${per.label})</h2>
      <div class="actions">
        <button id="btnSyncAds" class="btn-primary">Sync agora</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi warn">
        <div class="kpi-label">Gasto total no mes</div>
        <div class="kpi-value">${money(t.gasto_total)}</div>
        <div class="kpi-sub">${t.total_campanhas || 0} campanha${t.total_campanhas === 1 ? '' : 's'}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Impressoes / Cliques</div>
        <div class="kpi-value">${(t.prints || 0).toLocaleString('pt-BR')}</div>
        <div class="kpi-sub">${(t.clicks || 0).toLocaleString('pt-BR')} cliques · CTR ${(t.ctr_medio || 0).toFixed(2)}%</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">CPC medio</div>
        <div class="kpi-value">${money(t.cpc_medio)}</div>
        <div class="kpi-sub">custo por clique</div>
      </div>
      <div class="kpi ok">
        <div class="kpi-label">Vendas geradas (Ads)</div>
        <div class="kpi-value">${money(t.total_amount)}</div>
        <div class="kpi-sub">direto: ${money(t.direct_amount)}</div>
      </div>
      <div class="kpi ${(t.roas || 0) >= 4 ? 'ok' : 'warn'}">
        <div class="kpi-label">ROAS</div>
        <div class="kpi-value">${(t.roas || 0).toFixed(2)}x</div>
        <div class="kpi-sub">ACOS ${(t.acos_geral || 0).toFixed(1)}%</div>
      </div>
    </div>

    <div class="card mt-1">
      <h3>Campanhas (${(data.campanhas || []).length})</h3>
      <table>
        <thead>
          <tr>
            <th>Nome</th><th>Status</th><th class="text-right">Diario</th>
            <th class="text-right">Cost</th><th class="text-right">Cliques</th><th class="text-right">CPC</th>
            <th class="text-right">CTR</th><th class="text-right">Vendas</th><th class="text-right">ROAS</th>
          </tr>
        </thead>
        <tbody>
          ${(data.campanhas || []).map(c => `
            <tr>
              <td>${c.nome || '(sem nome)'}</td>
              <td><span class="badge ${c.status === 'active' ? 'ok' : 'warn'}">${c.status || '-'}</span></td>
              <td class="text-right">${money(c.daily_budget)}</td>
              <td class="text-right value-money negativo">${money(c.cost)}</td>
              <td class="text-right">${c.clicks || 0}</td>
              <td class="text-right">${money(c.cpc)}</td>
              <td class="text-right">${(c.ctr || 0).toFixed(2)}%</td>
              <td class="text-right value-money positivo">${money(c.total_amount)}</td>
              <td class="text-right">${c.cost > 0 ? ((c.total_amount || 0) / c.cost).toFixed(2) + 'x' : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="9" class="text-muted">Nenhuma campanha ainda. Roda Sync agora.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  $('#btnSyncAds').addEventListener('click', async () => {
    try {
      const r = await api(`api/sync/mercadoads?de=${per.de}&ate=${per.ate}`, { method: 'POST' });
      alert(`Ads: ${r.processados} campanhas atualizadas`);
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
routes.pedidos = async () => {
  const [pedidos, fornecedores, produtos, cfg] = await Promise.all([
    api('api/pedidos-compra'),
    api('api/pedidos-compra/fornecedores'),
    api('api/produtos'),
    api('api/config'),
  ]);
  const custoRafael = Number(cfg.custo_coleta_rafael_bocao || 110);

  $('#content').innerHTML = `
    <div class="page-header">
      <h2>Pedidos de compra</h2>
      <div class="actions">
        <button id="btnNovoPedido" class="btn-primary">Novo pedido</button>
      </div>
    </div>

    <div id="formNovoPedido" class="card" style="display:none">
      <h3>Novo pedido</h3>
      <div class="form-grid">
        <label>Fornecedor
          <select id="novoFornecedor">
            ${fornecedores.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
          </select>
        </label>
        <label>Data do pedido
          <input type="date" id="novaData" value="${new Date().toISOString().slice(0,10)}" />
        </label>
        <label>Observacao <input id="novaObs" placeholder="opcional" /></label>
      </div>
      <h4 class="mt-1">Itens</h4>
      <table id="itensTable">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Custo unit.</th><th>Subtotal</th><th></th></tr></thead>
        <tbody id="itensBody"></tbody>
      </table>
      <div class="mt-1" style="display:flex;gap:.5rem;align-items:center;justify-content:space-between">
        <button id="btnAddItem" class="btn-secondary">+ item</button>
        <div>Total: <strong id="totalPedido">R$ 0,00</strong></div>
        <div>
          <button id="btnCancelarNovo" class="btn-secondary">Cancelar</button>
          <button id="btnSalvarPedido" class="btn-primary">Salvar pedido</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Pedidos (${pedidos.length})</h3>
      <table>
        <thead><tr><th>#</th><th>Data</th><th>Fornecedor</th><th class="text-right">Itens</th><th class="text-right">Pecas</th><th class="text-right">Valor</th><th>Status</th><th>Coleta</th><th></th></tr></thead>
        <tbody>
          ${pedidos.map(p => `
            <tr>
              <td>#${p.id}</td>
              <td>${fmtDate(p.data_pedido)}</td>
              <td>${p.fornecedor_nome}</td>
              <td class="text-right">${p.itens_count}</td>
              <td class="text-right">${p.total_pecas || 0}</td>
              <td class="text-right value-money">${money(p.valor_total)}</td>
              <td><span class="badge ${p.status === 'recebido' ? 'ok' : p.status === 'cancelado' ? 'critico' : 'warn'}">${p.status}</span></td>
              <td>${p.coletado_por ? (p.coletado_por === 'RAFAEL_BOCAO' ? 'Rafael Bocao' : p.coletado_por === 'LEANDRO' ? 'Leandro' : (p.coletado_por_nome || 'Outro')) + (p.custo_coleta > 0 ? ' · ' + money(p.custo_coleta) : '') : '-'}</td>
              <td>${p.status === 'aberto' ? `<button class="btn-secondary" data-receber="${p.id}">Receber</button>` : ''}</td>
            </tr>
          `).join('') || '<tr><td colspan="9" class="text-muted">Nenhum pedido ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const itens = [];
  function renderItens() {
    let total = 0;
    $('#itensBody').innerHTML = itens.map((it, i) => {
      const sub = (it.quantidade || 0) * (it.custo_unitario || 0);
      total += sub;
      const p = produtos.find(pr => pr.id === it.produto_id);
      return `
        <tr>
          <td>${p ? p.sku + ' - ' + p.nome : '?'}</td>
          <td>${it.quantidade}</td>
          <td class="value-money">${money(it.custo_unitario)}</td>
          <td class="value-money">${money(sub)}</td>
          <td><button class="btn-secondary" data-remitem="${i}">x</button></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="5" class="text-muted">Sem itens ainda.</td></tr>';
    $('#totalPedido').textContent = money(total);
    $$('[data-remitem]').forEach(b => b.addEventListener('click', () => { itens.splice(Number(b.dataset.remitem), 1); renderItens(); }));
  }

  $('#btnNovoPedido').addEventListener('click', () => {
    $('#formNovoPedido').style.display = 'block';
    renderItens();
  });
  $('#btnCancelarNovo').addEventListener('click', () => {
    $('#formNovoPedido').style.display = 'none';
    itens.length = 0;
  });
  $('#btnAddItem').addEventListener('click', () => {
    const opcoes = produtos.map(p => p.sku + ' - ' + p.nome + ' (custo atual: ' + money(p.custo_unitario) + ')').join('\n');
    const escolhido = prompt('Cole o SKU do produto:\n\n' + opcoes);
    if (!escolhido) return;
    const p = produtos.find(pr => pr.sku.toLowerCase() === escolhido.trim().toLowerCase());
    if (!p) { alert('SKU nao encontrado'); return; }
    const qtd = Number(prompt('Quantidade:', '1'));
    if (!qtd || qtd <= 0) return;
    const custo = Number(prompt('Custo unitario (R$):', String(p.custo_unitario || 280)));
    if (!custo || custo <= 0) return;
    itens.push({ produto_id: p.id, quantidade: qtd, custo_unitario: custo });
    renderItens();
  });
  $('#btnSalvarPedido').addEventListener('click', async () => {
    if (itens.length === 0) { alert('Adicione pelo menos 1 item'); return; }
    try {
      await api('api/pedidos-compra', {
        method: 'POST',
        body: JSON.stringify({
          fornecedor_id: Number($('#novoFornecedor').value),
          data_pedido: $('#novaData').value,
          observacao: $('#novaObs').value || null,
          itens,
        }),
      });
      routes.pedidos();
    } catch (err) { alert('Erro: ' + err.message); }
  });

  $$('[data-receber]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pedidoId = btn.dataset.receber;
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
