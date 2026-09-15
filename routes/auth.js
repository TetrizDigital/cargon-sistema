// Rotas de autenticacao: login, logout, me
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ error: 'email e senha obrigatorios' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND ativo = 1').get(String(email).toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'credenciais invalidas' });

  const ok = bcrypt.compareSync(senha, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'credenciais invalidas' });

  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userRole = user.role;

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  res.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'nao autenticado' });
  const user = db.prepare('SELECT id, email, name, role, last_login FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

module.exports = router;
