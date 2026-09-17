// SQLite + schema. Executa migrations idempotentes na inicializacao.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'sistema.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  modelo TEXT,
  ano_de TEXT,
  ano_ate TEXT,
  custo_unitario REAL NOT NULL DEFAULT 0,
  preco_venda REAL NOT NULL DEFAULT 0,
  frete_estimado REAL NOT NULL DEFAULT 0,
  estoque_atual INTEGER NOT NULL DEFAULT 0,
  estoque_minimo INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1,
  observacao TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produto_vinculos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  canal TEXT NOT NULL,
  id_externo TEXT NOT NULL,
  url TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(canal, id_externo),
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vinculos_produto ON produto_vinculos(produto_id);
CREATE INDEX IF NOT EXISTS idx_vinculos_canal ON produto_vinculos(canal);

CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canal TEXT NOT NULL,
  id_externo_pedido TEXT NOT NULL,
  data_venda TEXT NOT NULL,
  status TEXT NOT NULL,
  comprador_nome TEXT,
  comprador_email TEXT,
  comprador_telefone TEXT,
  valor_total REAL NOT NULL,
  valor_frete REAL NOT NULL DEFAULT 0,
  frete_confirmado INTEGER NOT NULL DEFAULT 0,
  taxa_canal REAL NOT NULL DEFAULT 0,
  valor_liquido REAL,
  data_repasse_previsto TEXT,
  observacao TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(canal, id_externo_pedido)
);

CREATE INDEX IF NOT EXISTS idx_vendas_canal ON vendas(canal);
CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(data_venda);
CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(status);

CREATE TABLE IF NOT EXISTS itens_venda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL,
  produto_id INTEGER,
  descricao TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  preco_unitario REAL NOT NULL,
  custo_unitario REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE INDEX IF NOT EXISTS idx_itens_venda_venda ON itens_venda(venda_id);
CREATE INDEX IF NOT EXISTS idx_itens_venda_produto ON itens_venda(produto_id);

CREATE TABLE IF NOT EXISTS movimentos_estoque (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  saldo_apos INTEGER NOT NULL,
  referencia_tipo TEXT,
  referencia_id INTEGER,
  observacao TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  criado_por INTEGER,
  FOREIGN KEY (produto_id) REFERENCES produtos(id),
  FOREIGN KEY (criado_por) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentos_estoque(produto_id);
CREATE INDEX IF NOT EXISTS idx_mov_data ON movimentos_estoque(criado_em);

CREATE TABLE IF NOT EXISTS lancamentos_caixa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  data TEXT NOT NULL,
  data_prevista TEXT,
  status TEXT NOT NULL DEFAULT 'realizado',
  venda_id INTEGER,
  conta_recorrente_id INTEGER,
  observacao TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  criado_por INTEGER,
  FOREIGN KEY (venda_id) REFERENCES vendas(id),
  FOREIGN KEY (conta_recorrente_id) REFERENCES contas_recorrentes(id),
  FOREIGN KEY (criado_por) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_lanc_data ON lancamentos_caixa(data);
CREATE INDEX IF NOT EXISTS idx_lanc_tipo ON lancamentos_caixa(tipo);
CREATE INDEX IF NOT EXISTS idx_lanc_categoria ON lancamentos_caixa(categoria);
CREATE INDEX IF NOT EXISTS idx_lanc_status ON lancamentos_caixa(status);

CREATE TABLE IF NOT EXISTS contas_recorrentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL,
  valor REAL NOT NULL,
  dia_vencimento INTEGER NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  ultimo_gerado_em TEXT,
  observacao TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integracao_ml (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ml_user_id TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integracao_tiktok (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canal TEXT NOT NULL,
  tipo TEXT NOT NULL,
  status TEXT NOT NULL,
  itens_processados INTEGER DEFAULT 0,
  mensagem TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_canal ON sync_logs(canal);
CREATE INDEX IF NOT EXISTS idx_sync_data ON sync_logs(criado_em);
`;

db.exec(SCHEMA);

// -------- Migrations idempotentes (colunas adicionadas depois do schema inicial) --------
function addColumn(table, col, defSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defSql}`);
    console.log(`[db] migration: ${table}.${col} adicionada`);
  }
}
addColumn('vendas', 'mercadolibre_fee',      'REAL NOT NULL DEFAULT 0');   // comissao ML real
addColumn('vendas', 'shipping_cost_seller',  'REAL NOT NULL DEFAULT 0');   // frete pago pelo vendedor (nao estimado)
addColumn('vendas', 'shipping_id',           'TEXT');                       // id do shipment ML
addColumn('vendas', 'payment_method',        'TEXT');                       // pix, credit_card, etc
addColumn('vendas', 'taxa_detalhes',         'TEXT');                       // JSON com detalhes brutos (fee_details, etc)

// -------- Tabelas de pedidos de compra e inventario --------
db.exec(`
  CREATE TABLE IF NOT EXISTS fornecedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL,
    contato TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    observacao TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pedidos_compra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fornecedor_id INTEGER NOT NULL,
    data_pedido TEXT NOT NULL,
    data_recebimento TEXT,
    valor_total REAL NOT NULL DEFAULT 0,
    coletado_por TEXT,
    coletado_por_nome TEXT,
    custo_coleta REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'aberto',
    observacao TEXT,
    criado_em TEXT DEFAULT (datetime('now')),
    recebido_em TEXT,
    criado_por INTEGER,
    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id),
    FOREIGN KEY (criado_por) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS pedidos_compra_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    quantidade INTEGER NOT NULL,
    custo_unitario REAL NOT NULL,
    FOREIGN KEY (pedido_id) REFERENCES pedidos_compra(id) ON DELETE CASCADE,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pc_status ON pedidos_compra(status);
  CREATE INDEX IF NOT EXISTS idx_pc_fornecedor ON pedidos_compra(fornecedor_id);
  CREATE INDEX IF NOT EXISTS idx_pci_pedido ON pedidos_compra_itens(pedido_id);

  CREATE TABLE IF NOT EXISTS inventarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_contagem TEXT NOT NULL,
    usuario_id INTEGER,
    observacao TEXT,
    status TEXT NOT NULL DEFAULT 'aberto',
    criado_em TEXT DEFAULT (datetime('now')),
    finalizado_em TEXT,
    FOREIGN KEY (usuario_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS inventarios_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventario_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    qtd_antes INTEGER NOT NULL,
    qtd_contada INTEGER,
    diferenca INTEGER,
    FOREIGN KEY (inventario_id) REFERENCES inventarios(id) ON DELETE CASCADE,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
  );

  CREATE INDEX IF NOT EXISTS idx_inv_status ON inventarios(status);
  CREATE INDEX IF NOT EXISTS idx_invi_inv ON inventarios_itens(inventario_id);
`);

// Seed fornecedor Oliver Parts
try {
  db.prepare(`INSERT OR IGNORE INTO fornecedores (nome, contato) VALUES ('Oliver Parts', 'Thaiza')`).run();
} catch {}

function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, atualizado_em)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, atualizado_em = datetime('now')
  `).run(key, String(value));
}

module.exports = { db, getSetting, setSetting };
