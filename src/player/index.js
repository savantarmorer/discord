// ============================================
// player/index.js — Portão do bot de reprodução
// ============================================
// O bot de reprodução toca gravações em canal de voz. Durante a prévia da Ágora
// ele fica desligado junto com os demais recursos antigos: só conecta ao Discord
// com RECURSOS_LEGADOS=true. Desligado, mantém apenas o health check no ar para a
// hospedagem (Render/Railway) não reiniciar o serviço em loop.

import 'dotenv/config';
import http from 'http';

if (process.env.RECURSOS_LEGADOS === 'true') {
  await import('./app.js');
} else {
  console.log('🔕 Bot de reprodução desligado durante a prévia da Ágora (RECURSOS_LEGADOS != true).');
  const PORT = process.env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Bot de reproducao desligado (previa da Agora).');
    })
    .listen(PORT, () => console.log(`📡 Health check na porta ${PORT}`));
}
