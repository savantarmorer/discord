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

-- ============================================
-- Incremento atômico de tempo de presença/fala
-- ============================================
-- addPresenceTime/addSpeakingTime usam essas funções em vez de ler o total
-- e escrever de volta em JS — duas chamadas concorrentes pro mesmo usuário
-- (ex.: o flush periódico de 5min e o evento de sair do canal, batendo no
-- mesmo instante) faziam uma sobrescrever o incremento da outra, perdendo
-- segundos de presença/fala e deixando os níveis dessincronizados.
CREATE OR REPLACE FUNCTION increment_presence_time(p_user_id TEXT, p_seconds INTEGER)
RETURNS TABLE(total_presence_time INTEGER, total_speaking_time INTEGER, bonus_xp INTEGER) AS $$
BEGIN
  RETURN QUERY
  UPDATE voice_metrics
  SET total_presence_time = voice_metrics.total_presence_time + p_seconds,
      last_connected = now()::text
  WHERE user_id = p_user_id
  RETURNING voice_metrics.total_presence_time, voice_metrics.total_speaking_time, voice_metrics.bonus_xp;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_speaking_time(p_user_id TEXT, p_seconds INTEGER)
RETURNS TABLE(total_presence_time INTEGER, total_speaking_time INTEGER, bonus_xp INTEGER) AS $$
BEGIN
  RETURN QUERY
  UPDATE voice_metrics
  SET total_speaking_time = voice_metrics.total_speaking_time + p_seconds
  WHERE user_id = p_user_id
  RETURNING voice_metrics.total_presence_time, voice_metrics.total_speaking_time, voice_metrics.bonus_xp;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Arquivo de gravações de calls (/calls, /renomearcall)
-- ============================================
CREATE TABLE IF NOT EXISTS call_recordings (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  session_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  title TEXT,
  category TEXT,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  listen_count INTEGER NOT NULL DEFAULT 0,
  video_storage_path TEXT,
  renamed_by TEXT,
  renamed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_recording_votes (
  recording_id BIGINT NOT NULL REFERENCES call_recordings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recording_id, user_id)
);

CREATE TABLE IF NOT EXISTS call_recording_comments (
  id BIGSERIAL PRIMARY KEY,
  recording_id BIGINT NOT NULL REFERENCES call_recordings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_recording_participants (
  recording_id BIGINT NOT NULL REFERENCES call_recordings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  spoke BOOLEAN NOT NULL DEFAULT false,
  speaking_ms INTEGER NOT NULL DEFAULT 0,
  presence_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (recording_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_guild_category ON call_recordings(guild_id, category);
CREATE INDEX IF NOT EXISTS idx_call_recording_comments_recording ON call_recording_comments(recording_id);
CREATE INDEX IF NOT EXISTS idx_call_recording_participants_user ON call_recording_participants(user_id);

ALTER TABLE call_recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role" ON call_recordings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE call_recording_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role" ON call_recording_votes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE call_recording_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role" ON call_recording_comments FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE call_recording_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role" ON call_recording_participants FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Estado do ARG de menção (src/utils/argSystem.js)
-- ============================================
-- Guarda a ordem embaralhada (e ainda não revelada) dos fragmentos —
-- persistido porque o processo reinicia com frequência em deploy, e
-- perder o progresso a cada redeploy arruinaria o "quebra-cabeça".
CREATE TABLE IF NOT EXISTS bot_arg_state (
  id INTEGER PRIMARY KEY,
  remaining_fragments INTEGER[] NOT NULL DEFAULT '{}'
);
INSERT INTO bot_arg_state (id, remaining_fragments) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;

ALTER TABLE bot_arg_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role" ON bot_arg_state FOR ALL USING (true) WITH CHECK (true);
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

# Opcionais — gravação completa de calls (áudio mixado de todos os falantes,
# dividido em blocos de 30 minutos, enviado ao Supabase Storage):
SUPABASE_SERVICE_KEY=sua_chave_service_role_aqui
RECORDINGS_CHANNEL_ID=id_do_canal_de_texto_para_postar_os_links

# Opcional — cargo exigido para usar /calls e /renomearcall (arquivo de
# gravações antigas). Sem essa variável, ninguém tem acesso ao arquivo.
CALLS_ARCHIVE_ROLE_ID=id_do_cargo_com_acesso_ao_arquivo
```

> Para a gravação de calls funcionar, crie no Supabase um bucket de Storage
> **privado** chamado `call-recordings` (Storage → New bucket). Nenhuma
> política de RLS é necessária — o upload usa a chave `service_role`, que
> ignora RLS automaticamente.

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

## 🎧 Bot de Reprodução (opcional)

Um **segundo bot**, processo e serviço Render separados (`src/player/`), que toca gravações arquivadas numa sala de voz dedicada. Precisa ser um bot separado porque o Discord só permite uma conexão de voz por servidor por token — o bot principal já usa a dele para gravar a call ao vivo.

### 1. Crie uma segunda aplicação no Discord Developer Portal

Mesmo processo do bot principal (seção 3 acima), mas um app **novo e separado**:
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** → copie o Token → essa é a `PLAYER_BOT_TOKEN`
3. **General Information** → copie o Application ID → essa é a `PLAYER_BOT_CLIENT_ID`
4. **OAuth2 > URL Generator** → Scopes: `bot`, `applications.commands` → Bot Permissions: `Connect`, `Speak`, `View Channels` → convide esse bot ao mesmo servidor

### 2. Crie o canal de voz dedicado

Um canal de voz normal no servidor (ex.: "🎧 Sala de Reprodução"). Copie o ID do canal (modo desenvolvedor ativado → botão direito → Copiar ID).

### 3. Configure um segundo serviço no Render

Mesmo repositório GitHub do bot principal, mas um **novo serviço** (Background Worker):
- **Root Directory**: `src` (igual ao bot principal)
- **Build Command**: `npm install`
- **Start Command**: `node player/index.js`
- **Environment Variables**:
  ```env
  PLAYER_BOT_TOKEN=token_do_segundo_app
  PLAYER_BOT_CLIENT_ID=client_id_do_segundo_app
  DISCORD_GUILD_ID=mesmo_guild_id_do_bot_principal
  PLAYER_VOICE_CHANNEL_ID=id_do_canal_de_voz_dedicado
  SUPABASE_URL=mesma_url_do_bot_principal
  SUPABASE_KEY=mesma_chave_do_bot_principal
  SUPABASE_SERVICE_KEY=mesma_service_role_key_do_bot_principal
  CALLS_ARCHIVE_ROLE_ID=mesmo_cargo_do_arquivo_de_calls
  ```

### Comandos

| Comando | Descrição |
|---|---|
| `/tocar` | Abre o mesmo menu de categoria → gravação do `/calls`; ao selecionar, entra na sala e começa a tocar |
| `/pause` | Pausa a reprodução atual |
| `/continuar` | Retoma a reprodução pausada |
| `/pular` | Pula para a próxima parte da mesma call (se ela tiver mais de 30min, dividida em blocos) |
| `/parar` | Para a reprodução e sai do canal de voz |
| `/status` | Mostra o que está tocando agora |

Como as gravações já são `.ogg`/Opus (mesmo formato que o Discord usa), elas tocam direto sem precisar reprocessar com ffmpeg.

### Geração automática de vídeo

O mesmo processo do bot de reprodução também roda, em segundo plano, um worker que converte cada gravação de áudio pendente num `.mp4` com visualização de onda sonora (filtro `showwaves` do ffmpeg — sem precisar de nenhuma imagem externa), pronto pra upload manual no YouTube. Checa por uma gravação sem vídeo a cada 5 minutos, processa uma de cada vez, envia o resultado pro mesmo bucket do Storage e posta o link em `RECORDINGS_CHANNEL_ID` (mesma variável já usada pelo bot principal — pode reaproveitar o mesmo canal). Não sobe nada pro YouTube automaticamente — isso continua manual.

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
