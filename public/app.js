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
routes.dashboard = async () => {
  const [resumo, estoque, vendas] = await Promise.all([
    api('api/financeiro/resumo'),
    api('api/estoque'),
    api('api/vendas?limit=10'),
  ]);

  const v = resumo.vendas || { totais: {}, cmv: 0, lucro_bruto: 0, taxa_media_pct: 0, ticket_medio: 0, por_canal: [] };
  const t = v.totais || {};

  $('#content').innerHTML = `
    <div class="page-header"><h2>Dashboard</h2></div>

    <h3 class="mb-1" style="color:var(--cinza-3);font-size:.85rem;text-transform:uppercase;letter-spacing:1px">Vendas do mes (${resumo.periodo.de} a ${resumo.periodo.ate})</h3>
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
      <div class="kpi ${v.lucro_bruto >= 0 ? 'ok' : 'warn'}">
        <div class="kpi-label">LUCRO BRUTO</div>
        <div class="kpi-value">${money(v.lucro_bruto)}</div>
        <div class="kpi-sub">receita − taxas − frete − CMV</div>
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
      <h3>Ultimas vendas</h3>
      <table>
        <thead><tr><th>Data</th><th>Canal</th><th>Comprador</th><th>Status</th><th class="text-right">Valor</th></tr></thead>
        <tbody>
          ${vendas.map(v => `
            <tr>
              <td>${fmtDate(v.data_venda)}</td>
              <td><span class="badge ${badgeCanal(v.canal)}">${labelCanal(v.canal)}</span></td>
              <td>${v.comprador_nome || '-'}</td>
              <td>${v.status}</td>
              <td class="text-right value-money">${money(v.valor_total)}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="text-muted">Sem vendas no periodo.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
};

function labelCanal(c) {
  return c === 'MERCADO_LIVRE' ? 'Mercado Livre'
       : c === 'SITE_PROPRIO' ? 'Site Cargon'
       : c === 'TIKTOK_SHOP' ? 'TikTok Shop'
       : c;
}
function badgeCanal(c) {
  return c === 'MERCADO_LIVRE' ? 'canal-ml'
       : c === 'SITE_PROPRIO' ? 'canal-site'
       : c === 'TIKTOK_SHOP' ? 'canal-tiktok'
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
};

boot().catch(err => {
  console.error(err);
  window.location.href = 'login';
});
