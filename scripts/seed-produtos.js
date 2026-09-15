// Importa os 14 SKUs iniciais da Cargon.
// Pode rodar como script (npm run seed-produtos) OU ser chamado do sistema-app.js.
const { db } = require('../db');

const CUSTO = 280;
const PRECO = 949;
const FRETE_EST = 60;

const PRODUTOS = [
  { sku: '885',   nome: 'Protetor Caçamba Toyota Hilux CD 2016-2026',       modelo: 'Hilux CD',       ano_de: '2016', ano_ate: '2026', estoque: 0,  ml: 'MLB4880118463' },
  { sku: 'Pa47',  nome: 'Protetor Caçamba Ford Ranger CD 2024',              modelo: 'Ranger CD',      ano_de: '2024', ano_ate: '2024', estoque: 0,  ml: 'MLB5174861895' },
  { sku: 'Pa79',  nome: 'Protetor Caçamba Ford Ranger CD 2025-2026',         modelo: 'Ranger CD',      ano_de: '2025', ano_ate: '2026', estoque: 1,  ml: 'MLB5174850071' },
  { sku: '3235',  nome: 'Protetor Caçamba Ford Maverick',                    modelo: 'Maverick',       ano_de: null,   ano_ate: null,   estoque: 1,  ml: 'MLB5215382475' },
  { sku: '1222',  nome: 'Protetor Caçamba Ford Ranger CD 2013-2022',         modelo: 'Ranger CD',      ano_de: '2013', ano_ate: '2022', estoque: 1,  ml: 'MLB5174861831' },
  { sku: 'Pa101', nome: 'Protetor Caçamba Ford Ranger CD 2023',              modelo: 'Ranger CD',      ano_de: '2023', ano_ate: '2023', estoque: 1,  ml: 'MLB5174849973' },
  { sku: '825',   nome: 'Protetor Caçamba Fiat Toro',                        modelo: 'Toro',           ano_de: null,   ano_ate: null,   estoque: 1,  ml: 'MLB4870768317' },
  { sku: '1228',  nome: 'Protetor Caçamba Nissan Frontier 2017-2022',        modelo: 'Frontier',       ano_de: '2017', ano_ate: '2022', estoque: 1,  ml: null },
  { sku: 'Pa133', nome: 'Protetor Caçamba Chevrolet S10 2025',               modelo: 'S10 CD',         ano_de: '2025', ano_ate: '2025', estoque: 2,  ml: 'MLB7265850278' },
  { sku: 'Pa146', nome: 'Protetor Caçamba Mitsubishi Triton Katana 2025-2026', modelo: 'Triton Katana', ano_de: '2025', ano_ate: '2026', estoque: 2,  ml: 'MLB5174861969' },
  { sku: '1239',  nome: 'Protetor Caçamba Chevrolet S10 CD 2013-2024',       modelo: 'S10 CD',         ano_de: '2013', ano_ate: '2024', estoque: 3,  ml: 'MLB4871454977' },
  { sku: '1230',  nome: 'Protetor Caçamba VW Amarok CD 2011-2026',           modelo: 'Amarok CD',      ano_de: '2011', ano_ate: '2026', estoque: 3,  ml: 'MLB4870762435' },
  { sku: 'Pa3',   nome: 'Protetor Caçamba Ram Rampage',                      modelo: 'Rampage',        ano_de: null,   ano_ate: null,   estoque: 4,  ml: 'MLB7265862786' },
  { sku: 'Pa48',  nome: 'Protetor Caçamba VW Saveiro Dupla 2017-2025',       modelo: 'Saveiro CD',     ano_de: '2017', ano_ate: '2025', estoque: 0,  ml: 'MLB4871692625' },
  { sku: 'STRADA-CD', nome: 'Protetor Caçamba Fiat Strada CD (Volcano/Freedom/Ranch)', modelo: 'Strada CD', ano_de: '2021', ano_ate: '2026', estoque: 0, ml: 'MLB7135302948', mlExtra: 'MLB7134980634' },
];

function seedProdutos() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n;
  if (total > 0) {
    return { skipped: true, motivo: `ja existem ${total} produtos, seed pulado` };
  }

  const insertProduto = db.prepare(`
    INSERT INTO produtos (sku, nome, modelo, ano_de, ano_ate, custo_unitario, preco_venda, frete_estimado, estoque_atual, estoque_minimo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku) DO NOTHING
  `);
  const insertVinculo = db.prepare(`
    INSERT INTO produto_vinculos (produto_id, canal, id_externo)
    VALUES (?, ?, ?)
    ON CONFLICT(canal, id_externo) DO NOTHING
  `);
  const insertMov = db.prepare(`
    INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, observacao)
    VALUES (?, 'AJUSTE', ?, ?, 'seed_inicial', 'Saldo inicial - baseline Obsidian 14/09/2026')
  `);

  const trans = db.transaction(() => {
    let count = 0;
    let pecas = 0;
    for (const p of PRODUTOS) {
      insertProduto.run(p.sku, p.nome, p.modelo, p.ano_de, p.ano_ate, CUSTO, PRECO, FRETE_EST, p.estoque, 1);
      const id = db.prepare('SELECT id FROM produtos WHERE sku = ?').get(p.sku).id;
      if (p.ml) insertVinculo.run(id, 'MERCADO_LIVRE', p.ml);
      if (p.mlExtra) insertVinculo.run(id, 'MERCADO_LIVRE', p.mlExtra);
      if (p.estoque > 0) insertMov.run(id, p.estoque, p.estoque);
      count++;
      pecas += p.estoque;
    }
    return { count, pecas };
  });

  const r = trans();
  return { skipped: false, ...r };
}

module.exports = { seedProdutos };

// Rodar direto (CLI)
if (require.main === module) {
  const r = seedProdutos();
  if (r.skipped) {
    console.log('[seed] ' + r.motivo);
  } else {
    console.log('[seed] ' + r.count + ' produtos importados, ' + r.pecas + ' pecas em estoque');
  }
}
