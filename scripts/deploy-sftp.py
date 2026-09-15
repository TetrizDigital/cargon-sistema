"""Deploy do Cargon Sistema via SFTP no VPS cargondev@74.1.21.169."""
import os
import sys
import paramiko
from pathlib import Path

HOST = '74.1.21.169'
USER = 'cargondev'
KEY = os.path.expanduser('~/.ssh/id_ed25519')
REMOTE_BASE = '/cargonparts'
REMOTE_SISTEMA = REMOTE_BASE + '/sistema'
LOCAL_BASE = Path(__file__).resolve().parent.parent
SYSTEM_SNIPPET = """
// -------- Sistema Cargon (sub-app em /sistema) --------
try {
  app.use('/sistema', require('./sistema/sistema-app'));
  console.log('[cargon] sub-app /sistema montado em /sistema');
} catch (e) {
  console.error('[cargon] falha ao montar /sistema:', e.message);
}

"""

# Arquivos a enviar (relativos ao repo)
FILES = [
    'sistema-app.js',
    'db.js',
    'package.json',
    'routes/auth.js',
    'routes/produtos.js',
    'routes/estoque.js',
    'routes/vendas.js',
    'routes/financeiro.js',
    'routes/sync.js',
    'integrations/mercadolivre.js',
    'integrations/site.js',
    'public/login.html',
    'public/app.html',
    'public/styles.css',
    'public/app.js',
]

# Env vars pra colocar em .env do sistema (ficam no filesystem, so lidas se PM2 nao passar)
ENV_VARS = """NODE_ENV=production
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
"""


def ensure_dir(sftp, remote):
    parts = remote.strip('/').split('/')
    cur = ''
    for p in parts:
        cur += '/' + p
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)
            print(f'  mkdir {cur}')


def upload(sftp, local, remote):
    ensure_dir(sftp, os.path.dirname(remote))
    sftp.put(str(local), remote)
    print(f'  {local.name} -> {remote}')


def main():
    key = paramiko.Ed25519Key.from_private_key_file(KEY)
    t = paramiko.Transport((HOST, 22))
    t.connect(username=USER, pkey=key)
    sftp = paramiko.SFTPClient.from_transport(t)

    print('== 1. Criando pasta sistema/ ==')
    ensure_dir(sftp, REMOTE_SISTEMA)
    ensure_dir(sftp, REMOTE_SISTEMA + '/data')

    print('== 2. Upload dos arquivos do sistema ==')
    for f in FILES:
        local = LOCAL_BASE / f
        if not local.exists():
            print(f'  !! nao existe: {local}')
            continue
        remote = REMOTE_SISTEMA + '/' + f
        upload(sftp, local, remote)

    print('== 3. Escrevendo .env ==')
    envfile = REMOTE_SISTEMA + '/.env'
    with sftp.open(envfile, 'w') as f:
        f.write(ENV_VARS)
    sftp.chmod(envfile, 0o600)
    print(f'  {envfile} (perm 600)')

    print('== 4. Modificando server.js do site ==')
    # baixa server.js atual
    server_bytes = b''
    with sftp.open(REMOTE_BASE + '/server.js', 'rb') as f:
        server_bytes = f.read()
    server_text = server_bytes.decode('utf-8', errors='replace')

    if '/sistema/sistema-app' in server_text:
        print('  server.js JA TEM a linha do sistema. pulando modificacao.')
    else:
        # backup
        backup_path = REMOTE_BASE + '/server.js.bak-sistema'
        try:
            sftp.stat(backup_path)
            print(f'  backup ja existe: {backup_path}')
        except IOError:
            with sftp.open(backup_path, 'wb') as f:
                f.write(server_bytes)
            print(f'  backup salvo: {backup_path}')

        # insere antes do primeiro app.listen(
        idx = server_text.find('\napp.listen(')
        if idx < 0:
            print('  !! nao achou app.listen no server.js — nao vou modificar')
            sys.exit(1)
        new_text = server_text[:idx] + '\n' + SYSTEM_SNIPPET + server_text[idx:]

        with sftp.open(REMOTE_BASE + '/server.js', 'w') as f:
            f.write(new_text)
        print(f'  server.js modificado ({len(new_text)} bytes)')

    print('== 5. Verifica arquivos remotos ==')
    remote_files = sftp.listdir(REMOTE_SISTEMA)
    print(f'  {REMOTE_SISTEMA}: {sorted(remote_files)}')

    sftp.close()
    t.close()
    print('\n== deploy OK ==')
    print('- PM2 deve detectar mudanca em server.js e reiniciar (watch)')
    print('- Testar: https://cargonparts.com.br/sistema/api/health')


if __name__ == '__main__':
    main()
