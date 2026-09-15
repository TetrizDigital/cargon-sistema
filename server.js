// Modo standalone — usado apenas para dev local ou testes.
// Em producao o sistema-app.js e' montado dentro do server.js do site principal.
require('dotenv').config();

const express = require('express');
const sistemaApp = require('./sistema-app');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use('/sistema', sistemaApp);

app.get('/', (_req, res) => res.redirect('/sistema/'));

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`[cargon-sistema] standalone em http://localhost:${PORT}/sistema/`);
});
