# 🎙️ Discord Voice Metrics Bot

Bot Discord avançado para rastrear **tempo de presença** e **tempo de fala real** dos usuários em canais de voz.

## 📋 Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| **Tempo de Presença** | Rastreia quanto tempo cada usuário fica conectado a canais de voz |
| **Tempo de Fala Real** | Detecta quando o usuário está efetivamente falando (emitindo som) |
| **Auto-Join/Leave** | O bot entra automaticamente em canais com usuários e sai de canais vazios |
| **Failsafe** | Salva dados parciais a cada 5 minutos para proteção contra crashes |
| **Graceful Shutdown** | Salva todos os dados pendentes antes de encerrar |
| `/statusvoz` | Mostra métricas individuais com embed formatado |
| `/topfala` | Leaderboard com Top 10 usuários por tempo de fala |

---

## 🛠️ Pré-requisitos

- **Node.js** 18+ ([nodejs.org](https://nodejs.org))
- **Conta no Supabase** ([supabase.com](https://supabase.com))
- **Bot Discord** criado no [Discord Developer Portal](https://discord.com/developers/applications)

---

## 📦 Instalação

### 1. Instale as dependências

```bash
cd "d:\discord bot"
npm install
```

> **Nota:** o projeto usa `opusscript` (decodificador Opus em JS puro) em vez de `@discordjs/opus`, que exige compilação nativa e falha em várias plataformas de deploy (ex.: Railway). Nenhuma etapa extra é necessária.

### 2. Configure o Supabase

No painel do Supabase, vá em **SQL Editor** e execute:

```sql
-- ============================================
-- Tabela de métricas de voz
-- ============================================
CREATE TABLE IF NOT EXISTS voice_metrics (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  total_presence_time INTEGER DEFAULT 0,
  total_speaking_time INTEGER DEFAULT 0,
  last_connected TEXT
);

-- Índice para consultas de ranking
CREATE INDEX IF NOT EXISTS idx_voice_metrics_speaking 
  ON voice_metrics (total_speaking_time DESC);

-- Habilita RLS (Row Level Security) - opcional para bots com service_role key
ALTER TABLE voice_metrics ENABLE ROW LEVEL SECURITY;

-- Policy para permitir todas as operações via service_role
CREATE POLICY "Allow all operations for service role" 
  ON voice_metrics 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);
```

### 3. Configure o Bot no Discord Developer Portal

1. Acesse [discord.com/developers/applications](https://discord.com/developers/applications)
2. Crie um novo aplicativo ou selecione o existente
3. Vá em **Bot** e copie o **Token**
4. Em **Bot**, ative as seguintes **Privileged Gateway Intents**:
   - ✅ `PRESENCE INTENT`
   - ✅ `SERVER MEMBERS INTENT`
   - ✅ `MESSAGE CONTENT INTENT` (opcional)
5. Vá em **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `View Channels`, `Use Voice Activity`
6. Use a URL gerada para convidar o bot ao seu servidor

### 4. Configure as variáveis de ambiente

```bash
copy .env.example .env
```

Edite o arquivo `.env` com seus dados:

```env
DISCORD_TOKEN=seu_token_aqui
DISCORD_CLIENT_ID=seu_client_id_aqui
DISCORD_GUILD_ID=seu_guild_id_aqui
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_service_role_key_aqui
```

### 5. Registre os comandos de barra

Execute **uma vez** para registrar os slash commands:

```bash
npm run deploy-commands
```

### 6. Inicie o bot

```bash
npm start
```

Para desenvolvimento com auto-reload:

```bash
npm run dev
```

---

## 🏗️ Estrutura do Projeto

```
discord-bot/
├── .env.example          # Template de variáveis de ambiente
├── .gitignore
├── package.json
├── README.md
└── src/
    ├── index.js           # Ponto de entrada principal
    ├── config.js          # Configuração centralizada
    ├── database.js        # Camada de acesso ao Supabase
    ├── voiceTracker.js    # Rastreamento de tempo de presença
    ├── speakingTracker.js # Rastreamento de tempo de fala
    ├── voiceManager.js    # Gerenciamento de conexões de voz
    ├── commands/
    │   ├── deploy.js      # Script de deploy dos slash commands
    │   ├── statusvoz.js   # Comando /statusvoz
    │   └── topfala.js     # Comando /topfala
    └── utils/
        └── formatTime.js  # Utilitários de formatação
```

---

## 📖 Como Funciona

### Tempo de Presença
1. O bot escuta o evento `voiceStateUpdate` do Discord
2. Quando um usuário **entra** em um canal de voz → registra o timestamp de entrada
3. Quando o usuário **sai** → calcula a diferença e soma ao `total_presence_time`
4. Troca de canal é tratada como saída + entrada

### Tempo de Fala Real
1. O bot **se conecta automaticamente** a canais de voz que possuem usuários
2. Usando o `VoiceReceiver` da `@discordjs/voice`, ele escuta eventos de `speaking`
3. Quando um usuário **começa a falar** → registra o timestamp
4. Quando **para de falar** → calcula o tempo e soma ao `total_speaking_time`
5. Sessões menores que 0.3s são descartadas (anti-ruído)

### Proteção contra Crashes
- A cada 5 minutos, todos os dados em memória são salvos no Supabase (flush periódico)
- No shutdown (SIGINT/SIGTERM), todos os dados pendentes são salvos antes de encerrar

---

## ⚠️ Notas Importantes

- **O bot precisa NÃO estar surdo (`selfDeaf: false`)** para detectar fala dos usuários
- **O bot fica mutado (`selfMute: true`)** para não emitir som no canal
- **Mute/deaf do usuário** não afeta o tempo de presença, apenas o speaking event
- **Supabase com `service_role` key** é recomendado para bypass do RLS
- **Este bot precisa de um host persistente** (Railway, Render, VPS, etc.) — Netlify é serverless e não suporta processos 24/7

---

## 🚀 Deploy em Produção

Recomendações de hosting para processos persistentes:

| Serviço | Gratuito | Nota |
|---|---|---|
| [Railway](https://railway.app) | Trial $5 | Excelente para bots Node.js |
| [Render](https://render.com) | Sim (com limitações) | Background workers gratuitos |
| [Fly.io](https://fly.io) | Sim (com limitações) | Deploy com Docker |
| VPS (DigitalOcean, Hetzner) | Não | Controle total |

---

## 📜 Licença

MIT
