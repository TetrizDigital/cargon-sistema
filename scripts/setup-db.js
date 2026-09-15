// Setup inicial: cria usuarios admin usando ENV vars
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../db');

function upsertUser(email, name, senha, role = 'admin') {
  if (!senha) {
    console.log('[setup] senha vazia para ' + email + ' - pulado');
    return;
  }
  const hash = bcrypt.hashSync(senha, 10);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, name = ?, role = ?, ativo = 1 WHERE id = ?')
      .run(hash, name, role, existing.id);
    console.log('[setup] usuario atualizado: ' + email);
  } else {
    db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(email, hash, name, role);
    console.log('[setup] usuario criado: ' + email);
  }
}

if (process.env.ADMIN_EMAIL_LEANDRO && process.env.ADMIN_SENHA_LEANDRO) {
  upsertUser(process.env.ADMIN_EMAIL_LEANDRO.toLowerCase(), 'Leandro', process.env.ADMIN_SENHA_LEANDRO);
}
if (process.env.ADMIN_EMAIL_RAFAEL && process.env.ADMIN_SENHA_RAFAEL) {
  upsertUser(process.env.ADMIN_EMAIL_RAFAEL.toLowerCase(), 'Rafael', process.env.ADMIN_SENHA_RAFAEL);
}

console.log('[setup] concluido');
