// Reseta o estoque pros valores do baseline (14/09/2026) e define data de corte
// pra que vendas anteriores nao decrementem estoque no proximo sync.
const { db, setSetting } = require('../db');
const { seedProdutos } = require('./seed-produtos');

const DATA_CORTE = '2026-09-14T23:59:59Z'; // qualquer venda ate este momento nao mexe estoque

function reset() {
  console.log('[reset] limpando movimentos de venda antigos...');
  const delMov = db.prepare(`
    DELETE FROM movimentos_estoque
    WHERE referencia_tipo = 'venda'
  `).run();
  console.log('[reset] ' + delMov.changes + ' movimentos removidos');

  // Baseline do Obsidian 14/09/2026 (Estoque Atual.md)
  const BASELINE = {
    '885':       0,  // Hilux (Obsidian marcava -1 mas assumo 0)
    'Pa47':      0,  // Ranger 2024
    'Pa79':      1,  // Ranger 2025-2026
    '3235':      1,  // Maverick
    '1222':      1,  // Ranger 2013-2022
    'Pa101':     1,  // Ranger 2023
    '825':       1,  // Toro
    '1228':      1,  // Frontier
    'Pa133':     2,  // S10 2025
    'Pa146':     2,  // Katana
    '1239':      3,  // S10 2013-2024
    '1230':      3,  // Amarok
    'Pa3':       4,  // Rampage
    'Pa48':      0,  // Saveiro
    'STRADA-CD': 0,
  };

  console.log('[reset] ajustando saldos ao baseline...');
  const upd = db.prepare('UPDATE produtos SET estoque_atual = ? WHERE sku = ?');
  const insMov = db.prepare(`
    INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_apos, referencia_tipo, observacao)
    VALUES (?, 'AJUSTE', ?, ?, 'reset_baseline', 'Reset para baseline 14/09/2026')
  `);
  let total = 0;
  for (const [sku, saldo] of Object.entries(BASELINE)) {
    const p = db.prepare('SELECT id, estoque_atual FROM produtos WHERE sku = ?').get(sku);
    if (!p) { console.log('  !! sku nao existe: ' + sku); continue; }
    upd.run(saldo, sku);
    // registra movimento de ajuste (diferenca)
    const delta = saldo - p.estoque_atual;
    if (delta !== 0) insMov.run(p.id, delta, saldo);
    total += saldo;
    console.log('  ' + sku + ': ' + p.estoque_atual + ' -> ' + saldo);
  }

  setSetting('estoque_data_corte', DATA_CORTE);
  console.log('[reset] estoque_data_corte = ' + DATA_CORTE);
  console.log('[reset] total baseline: ' + total + ' pecas');
}

if (require.main === module) {
  reset();
}

module.exports = { reset };
