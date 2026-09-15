# Cargon Sistema

Sistema de gestão da Cargon Parts — estoque, financeiro, vendas multi-canal.

Servido em https://sistema.cargonparts.com.br

## Stack

- Node.js 18+
- Express 4
- SQLite via better-sqlite3
- Sessão + bcrypt (padrão do site principal)
- Vanilla JS SPA no frontend (sem build step)
- Hospedagem: cPanel HostGator via Passenger

## Estrutura

```
cargon-sistema/
├── server.js           # Express app + rotas de alto nível
├── db.js               # SQLite + schema idempotente
├── package.json
├── .env.example        # copiar para .env com secrets
├── routes/
│   ├── auth.js         # login, logout, sessão
│   ├── produtos.js     # CRUD produtos + vínculos com canais
│   ├── estoque.js      # movimentos, entradas, ajustes, alertas
│   ├── financeiro.js   # lançamentos, resumo, contas recorrentes
│   ├── vendas.js       # leitura de vendas, frete real
│   └── sync.js         # disparo manual de sync + status
├── integrations/
│   ├── mercadolivre.js # OAuth ML + sync de vendas
│   └── site.js         # sync com cargonparts.com.br
├── public/             # frontend (HTML + CSS + JS)
├── scripts/
│   ├── setup-db.js     # cria usuários admin (via ENV vars)
│   └── seed-produtos.js # importa os 14 SKUs iniciais
└── data/               # sistema.db (não commitado)
```

## Rodar local

```bash
npm install
cp .env.example .env
# editar .env com senhas
npm run setup-db     # cria usuários (Leandro + Rafael)
npm run seed-produtos # importa 14 SKUs
npm run dev          # roda em http://localhost:3010
```

## Deploy no HostGator

1. Application Manager já criado com Application Path `/home2/oncargo/sistema`
2. Git Version Control aponta pra este repositório
3. Environment Variables configuradas no cPanel:
   - `PORT` (o cPanel injeta)
   - `SESSION_SECRET` (gerar hex 64 chars)
   - `ADMIN_EMAIL_LEANDRO`, `ADMIN_SENHA_LEANDRO`
   - `ADMIN_EMAIL_RAFAEL`, `ADMIN_SENHA_RAFAEL`
   - `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`
   - `SITE_API_BASE_URL`, `SITE_API_KEY`
   - `SYNC_ENABLED=true`
4. Após deploy inicial, rodar via botão do cPanel (se houver) ou request HTTP:
   - `POST /api/sync/mercadolivre` para 1ª sync
5. Autorizar ML: acessar `https://sistema.cargonparts.com.br/api/ml/authorize` logado

## Backup

O banco `data/sistema.db` é um único arquivo. Backup = cópia do arquivo (com o servidor idealmente parado).

## Segurança

- Nunca commitar `.env`
- Nunca commitar arquivos em `data/`
- Credenciais sempre via Environment Variables no cPanel
