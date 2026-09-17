// Configuracoes gerais editaveis pela UI
const express = require('express');
const { getSetting, setSetting } = require('../db');

const router = express.Router();

const CHAVES = ['custo_coleta_rafael_bocao'];

router.get('/', (_req, res) => {
  const out = {};
  for (const k of CHAVES) {
    out[k] = getSetting(k, k === 'custo_coleta_rafael_bocao' ? '110' : null);
  }
  res.json(out);
});

router.put('/:key', (req, res) => {
  const key = req.params.key;
  if (!CHAVES.includes(key)) return res.status(400).json({ error: 'chave invalida' });
  const { value } = req.body || {};
  if (value == null) return res.status(400).json({ error: 'value obrigatorio' });
  setSetting(key, String(value));
  res.json({ ok: true });
});

module.exports = router;
