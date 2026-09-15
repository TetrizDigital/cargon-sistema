# Deploy do Cargon Sistema

Documento de deploy usado enquanto o subdomínio `sistema.cargonparts.com.br` está pendente da HostGator liberar Node.js no Application Manager (ticket em andamento).

## Arquitetura de deploy atual (Caminho B)

O sistema é montado como **sub-app Express** dentro do `server.js` do site principal:

- URL: `https://cargonparts.com.br/sistema/`
- Roda no mesmo processo Node do site
- Mesma infra: PM2, HTTPS, sessão isolada por cookie name `sistema_sid`
- Banco `sistema.db` fica em `/cargonparts/sistema/data/` (separado do `data.db` do site)

## Deploy inicial (uma vez)

### 1. Subir arquivos do sistema via SFTP

Conecta em `cargondev@74.1.21.169:22` com a chave `~/.ssh/id_ed25519` e envia o conteúdo do repo (exceto `.git/`, `node_modules/`, `data/`) para `/cargonparts/sistema/`.

Estrutura destino no VPS:
```
/cargonparts/                          ← site atual (não mexe)
├── server.js                          ← modificar (adicionar 1 linha)
├── package.json                       ← modificar (adicionar axios)
└── sistema/                           ← nossa pasta
    ├── sistema-app.js
    ├── db.js
    ├── package.json
    ├── routes/
    ├── integrations/
    ├── public/
    ├── scripts/
    └── data/                          ← criar vazia, banco cresce aqui
```

### 2. Adicionar 1 linha no `server.js` do site

Abrir `/cargonparts/server.js` do site e, ANTES da linha `app.listen(PORT, ...)` do final do arquivo, adicionar:

```js
// -------- Sistema Cargon (sub-app em /sistema) --------
try {
  app.use('/sistema', require('./sistema/sistema-app'));
  console.log('[cargon] sub-app /sistema montado');
} catch (e) {
  console.error('[cargon] falha ao montar /sistema:', e.message);
}
```

### 3. Adicionar dependência `axios` ao package.json do site

Editar `/cargonparts/package.json` do site e adicionar `"axios": "^1.7.7"` em `dependencies`.

Depois, instalar via SFTP + Node App do cPanel? Não — sem shell, precisa:

**Opção A** — Rodar `Ensure Dependencies` na Application Manager do site principal (se ele existir lá também)
**Opção B** — Subir `axios/` inteiro dentro de `/cargonparts/node_modules/` via SFTP
**Opção C** — Se o site tiver algum endpoint tipo "reload deps", usar

### 4. Configurar Environment Variables

Como a app roda dentro do processo do site, as env vars precisam estar disponíveis lá. Se o site tem `.env` na pasta ou env vars via PM2 config, adicionar as do sistema no mesmo lugar:

```
NODE_ENV=production
SESSION_SECRET=637167944a16d23353d82c262298ede494d167d5c7b75b53b8da868c3141792e
SYNC_ENABLED=true
ADMIN_EMAIL_LEANDRO=performance@tetrizdigital.com.br
ADMIN_SENHA_LEANDRO=VAiST41LC!Pa9P
ADMIN_EMAIL_RAFAEL=rafael@cargonparts.com.br
ADMIN_SENHA_RAFAEL=LhSmsA!Kyrl6QN
ML_CLIENT_ID=8839544002172014
ML_CLIENT_SECRET=u3q4EsBwIuUBkvByFSA1mSRIB02mtPgy
ML_REDIRECT_URI=https://cargonparts.com.br/sistema/api/ml/callback
SITE_API_BASE_URL=https://cargonparts.com.br
SITE_API_KEY=cargon-sync-7111414b1ecbf522fbb98b29fdfe246e6753ca1522f5b435
```

### 5. Restart PM2 automático

Assim que o `server.js` é modificado, PM2 detecta e reinicia sozinho (config já em uso pela Cargon).

### 6. Testar

Abrir https://cargonparts.com.br/sistema/api/health — deve retornar JSON `{ok: true, servico: "cargon-sistema"}`.

### 7. Popular estoque inicial

Como não conseguimos rodar scripts remotos, o `seed-produtos.js` precisa ser executado da seguinte forma:
- **Opção A** — Cadastrar os 14 SKUs pela própria UI depois de logar
- **Opção B** — Localmente, rodar `npm run seed-produtos` para gerar um `sistema.db` populado, e subir esse arquivo via SFTP pra `/cargonparts/sistema/data/`

## Migração futura pro subdomínio (quando HostGator liberar)

Quando o ticket for resolvido:
1. Remover a linha `app.use('/sistema', ...)` do `server.js` do site
2. Ativar a app no Application Manager
3. Trocar `ML_REDIRECT_URI` de `.com.br/sistema/api/ml/callback` para `sistema.cargonparts.com.br/api/ml/callback`
4. Trocar `<base href="/sistema/">` para `<base href="/">` nas HTMLs (ou usar `<base href="./">`)
