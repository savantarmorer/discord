// ============================================
// agora/comandos.js — Comandos da prévia da Ágora
// ============================================
// /menu (painel com botões e tutorial), /agora (conta, perfil, busca), /dracmas,
// /biblioteca (com o acervo do site), /mutirao e /assembleia.
// Botões, menus e formulários usam customId "<comando>:<ação>:…" e são roteados
// pelo index.js para handleInteraction / handleModalSubmit de cada comando.

import * as menu from './cmd-menu.js';
import * as agora from './cmd-agora.js';
import * as dracmas from './cmd-dracmas.js';
import * as biblioteca from './cmd-biblioteca.js';
import * as mutirao from './cmd-mutirao.js';
import * as assembleia from './cmd-assembleia.js';

export const comandosAgora = [menu, agora, dracmas, biblioteca, mutirao, assembleia];
