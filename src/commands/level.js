// ============================================
// commands/level.js — Comando /level
// ============================================
// Mostra o perfil completo de voz de um usuário.

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { getUserMetrics, getUserBadges, getBestFriend, getEconomy } from '../database.js';
import { getLevelData, renderProgressBar } from '../utils/levels.js';
import { formatTime, speakingPercentage } from '../utils/formatTime.js';
import { LOOT_TABLE, getCurrentBadgeInfo, syncMemberNicknameBadges } from '../utils/lootSystem.js';
import { getShowBadgesSetting, getUserSelectedBadges } from '../utils/userSettings.js';

export const data = new SlashCommandBuilder()
  .setName('level')
  .setDescription('Mostra o perfil completo de voz, nível, estatísticas e conquistas.')
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Usuário para consultar o perfil (padrão: você mesmo)')
      .setRequired(false)
  );

export function getLevelEmbedsAndComponents(authorId, targetUser, metrics, badges, bestFriend, activePage, authorBalance = 0) {
  // Cálculos de Nível e Progresso
  const lvl = getLevelData(metrics.total_presence_time, metrics.total_speaking_time, metrics.bonus_xp || 0);
  const progressBar = renderProgressBar(lvl.progressPercent, 15);
  
  // Formatação de Tempos
  const presenceFormatted = formatTime(metrics.total_presence_time);
  const speakingFormatted = formatTime(metrics.total_speaking_time);
  const percentage = speakingPercentage(metrics.total_speaking_time, metrics.total_presence_time);

  // Barra de Eficiência (Fala / Presença)
  const barLength = 15;
  const filledCount = Math.round(
    (metrics.total_speaking_time / Math.max(metrics.total_presence_time, 1)) * barLength
  );
  const filled = '█'.repeat(Math.min(filledCount, barLength));
  const empty = '░'.repeat(barLength - Math.min(filledCount, barLength));
  const efficiencyBar = `\`${filled}${empty}\` ${percentage}`;

  // Formata as badges para exibir no inventário
  let badgesDisplay = 'Nenhuma conquista desbloqueada ainda. Fale mais para dropar loot!';
  const uniqueBadges = [];
  if (badges && badges.length > 0) {
    const badgeCounts = {};
    badges.forEach(b => {
      if (!badgeCounts[b.badge_name]) {
        badgeCounts[b.badge_name] = { icon: b.badge_icon, count: 0 };
      }
      badgeCounts[b.badge_name].count++;
    });

    badgesDisplay = Object.entries(badgeCounts).map(([name, data]) => {
      const loot = LOOT_TABLE.find(l => l.name === name);
      let displayIcon = data.icon;
      let displayName = name;

      if (loot) {
        const badgeInfo = getCurrentBadgeInfo(loot, data.count);
        displayIcon = badgeInfo.icon;
        displayName = badgeInfo.name;
      }

      uniqueBadges.push({ name, displayName, icon: displayIcon });

      if (data.count > 1) {
        return `• ${displayIcon} **${displayName}** (x${data.count})`;
      }
      return `• ${displayIcon} **${displayName}**`;
    }).join('\n');
  }

  // Informação do Melhor Amigo
  let bestFriendDisplay = 'Ainda não passou tempo com ninguém.';
  if (bestFriend) {
    const timeTogether = formatTime(bestFriend.time);
    const hours = bestFriend.time / 3600;
    
    let hearts = '❤️🤍🤍🤍🤍';
    let status = 'Conhecidos';
    if (hours >= 50) {
      hearts = '❤️❤️❤️❤️❤️';
      status = 'Alma Gêmea';
    } else if (hours >= 15) {
      hearts = '❤️❤️❤️❤️🤍';
      status = 'Melhores Amigos';
    } else if (hours >= 5) {
      hearts = '❤️❤️❤️🤍🤍';
      status = 'Amigos de Call';
    } else if (hours >= 1) {
      hearts = '❤️❤️🤍🤍🤍';
      status = 'Parceiros de Papo';
    }
    
    bestFriendDisplay = `<@${bestFriend.id}>\n${hearts} **${status}**\n*(Juntos por \`${timeTogether}\`)*`;
  }

  const containerComponents = [];

  // Top Section (Title + Avatar thumbnail as accessory)
  containerComponents.push({
    type: 9, // SECTION
    components: [
      {
        type: 10, // Text Display
        content: activePage === 'stats'
          ? `# 👤 Perfil de Voz - ${targetUser.displayName || targetUser.username}`
          : activePage === 'badges'
            ? `# 🎒 Inventário de Conquistas`
            : activePage === 'friend'
              ? `# 🤝 Melhor Companhia`
              : `# 🏪 A Loja do Caos`
      }
    ],
    accessory: {
      type: 11, // THUMBNAIL
      media: {
        url: targetUser.displayAvatarURL({ size: 128, extension: 'png' })
      },
      description: 'Avatar do usuário'
    }
  });

  containerComponents.push({
    type: 14, // Separator
    divider: true,
    spacing: 1
  });

  if (activePage === 'stats') {
    containerComponents.push(
      {
        type: 10,
        content: `### 🛡️ Patente de Voz\n**${lvl.rank}**\n\n` +
          `### ✨ Nível Atual\n⚡ **Nível ${lvl.level}**\n\n` +
          `### 🧪 XP Acumulado\n🔮 \`${lvl.xp}\` XP total\n\n` +
          `### 🪙 Saldo na Carteira\n💰 \`${metrics.voice_coins || 0}\` Voice Coins`
      },
      {
        type: 14,
        divider: true,
        spacing: 1
      },
      {
        type: 10,
        content: `### 📈 Progresso para o Próximo Nível\n${progressBar}\n*(Progresso: \`${lvl.xpInCurrentLevel}\` / \`${lvl.xpNeededForNextLevel}\` XP)*`
      },
      {
        type: 14,
        divider: true,
        spacing: 1
      },
      {
        type: 10,
        content: `### 🎧 Presença Total\n\`${presenceFormatted}\`\n\n` +
          `### 🗣️ Fala Real\n\`${speakingFormatted}\`\n\n` +
          `### 📊 Eficiência de Conversa\n${efficiencyBar}\n\n` +
          `### 🕐 Última Conexão\n` + (metrics.last_connected ? `<t:${Math.floor(new Date(metrics.last_connected).getTime() / 1000)}:R>` : 'Nunca')
      }
    );
  } else if (activePage === 'badges') {
    containerComponents.push({
      type: 10,
      content: `Conquistas obtidas por **${targetUser.displayName || targetUser.username}** nos canais de voz.\n\n${badgesDisplay}`
    });
    if (authorId === targetUser.id && uniqueBadges.length > 0) {
      containerComponents.push({
        type: 14,
        divider: true,
        spacing: 1
      }, {
        type: 10,
        content: `⚙️ **Personalizar Nickname**\nVocê pode escolher até 3 conquistas no menu abaixo para fixar no seu nome do Discord. Se nenhuma for selecionada, o bot mostrará automaticamente as 3 mais raras.`
      });
    }
  } else if (activePage === 'friend') {
    containerComponents.push({
      type: 10,
      content: `### 👤 Parceiro de Call\n${bestFriendDisplay}`
    });
  } else if (activePage === 'shop') {
    containerComponents.push({
      type: 10,
      content: `💰 **Seu Saldo:** \`${authorBalance}\` Voice Coins\nEscolha um item abaixo para usar em alguém na call de voz:`
    }, {
      type: 14,
      divider: true,
      spacing: 1
    });

    const SHOP_ITEMS = {
      mordaca: { name: 'Mordaça 🤐', price: 100, desc: 'Muta um amigo no servidor por 10 segundos.' },
      surdez: { name: 'Surdez Súbita 🔇', price: 150, desc: 'Deixa um amigo totalmente surdo por 15 segundos.' },
      chute: { name: 'O Chute 👢', price: 400, desc: 'Derruba um amigo do canal de voz atual.' },
      teleporte: { name: 'Teleporte 🌀', price: 300, desc: 'Joga um amigo para um canal de voz aleatório.' },
      identidade: { name: 'Nova Identidade 🤡', price: 200, desc: 'Muda o apelido por uma piada por 10 minutos.' },
      trombadinha: { name: 'Trombadinha 🥷', price: 50, desc: 'Tenta roubar moedas de um amigo (50% de chance).' }
    };

    for (const [key, item] of Object.entries(SHOP_ITEMS)) {
      containerComponents.push({
        type: 9, // SECTION
        components: [
          {
            type: 10,
            content: `### ${item.name} (${item.price} coins)\n${item.desc}`
          }
        ],
        accessory: {
          type: 2, // BUTTON
          custom_id: `loja:select:${key}:${authorId}`,
          label: 'Escolher',
          style: 2 // Secondary
        }
      });
    }
  }

  containerComponents.push(
    {
      type: 14,
      divider: true,
      spacing: 1
    },
    {
      type: 10,
      content: `*Página: ${activePage === 'stats' ? 'Estatísticas' : activePage === 'badges' ? 'Conquistas' : activePage === 'friend' ? 'Melhor Companhia' : 'Loja do Caos'} · Solicitado por ${targetUser.username}*`
    }
  );

  const btnStats = new ButtonBuilder()
    .setCustomId(`level:stats:${authorId}:${targetUser.id}`)
    .setLabel('Estatísticas')
    .setEmoji('📊')
    .setStyle(activePage === 'stats' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(activePage === 'stats');

  const btnBadges = new ButtonBuilder()
    .setCustomId(`level:badges:${authorId}:${targetUser.id}`)
    .setLabel('Conquistas')
    .setEmoji('🎒')
    .setStyle(activePage === 'badges' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(activePage === 'badges');

  const btnFriend = new ButtonBuilder()
    .setCustomId(`level:friend:${authorId}:${targetUser.id}`)
    .setLabel('Melhor Companhia')
    .setEmoji('🤝')
    .setStyle(activePage === 'friend' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(activePage === 'friend');

  const btnShop = new ButtonBuilder()
    .setCustomId(`level:shop:${authorId}:${targetUser.id}`)
    .setLabel('Loja')
    .setEmoji('🏪')
    .setStyle(activePage === 'shop' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(activePage === 'shop');

  const showBadges = getShowBadgesSetting(targetUser.id);
  const btnToggle = new ButtonBuilder()
    .setCustomId(`level:toggleBadges:${authorId}:${targetUser.id}`)
    .setLabel(showBadges ? 'Emojis no Nome: Sim' : 'Emojis no Nome: Não')
    .setEmoji(showBadges ? '🏷️' : '✖️')
    .setStyle(showBadges ? ButtonStyle.Success : ButtonStyle.Danger)
    .setDisabled(authorId !== targetUser.id);

  const row = new ActionRowBuilder().addComponents(btnStats, btnBadges, btnFriend, btnShop, btnToggle);

  const rows = [row.toJSON()];

  if (activePage === 'badges' && authorId === targetUser.id && uniqueBadges.length > 0) {
    const userSelected = getUserSelectedBadges(authorId) || [];
    
    const options = [
      {
        label: 'Padrão (3 Mais Raras)',
        value: 'default',
        emoji: '❌',
        default: userSelected.length === 0
      },
      ...uniqueBadges.slice(0, 24).map(ub => {
        const opt = {
          label: ub.displayName,
          value: ub.name,
          default: userSelected.includes(ub.name)
        };
        if (ub.icon) opt.emoji = ub.icon;
        return opt;
      })
    ];

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`level:selectBadges:${authorId}:${targetUser.id}`)
      .setPlaceholder('Escolha até 3 conquistas para mostrar no nome...')
      .setMinValues(1)
      .setMaxValues(Math.min(3, options.length))
      .addOptions(options);

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);
    rows.push(selectRow.toJSON());
  }

  return {
    flags: 32768, // IS_COMPONENTS_V2
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 9133302, // 0x8B5CF6
        components: containerComponents
      },
      ...rows
    ]
  };
}

export async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('usuario') || interaction.user;

  // Sincroniza apelido forçadamente em segundo plano (não bloqueante)
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (member) {
    syncMemberNicknameBadges(member, true).catch(() => null);
  }

  // Busca métricas, badges, melhor amigo e economia do autor em paralelo
  const [metrics, badges, bestFriend, authorEcon] = await Promise.all([
    getUserMetrics(targetUser.id),
    getUserBadges(targetUser.id),
    getBestFriend(targetUser.id),
    getEconomy(interaction.user.id)
  ]);

  if (!metrics) {
    return interaction.editReply({
      flags: 32768,
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 9133302,
          components: [
            {
              type: 9, // SECTION
              components: [
                {
                  type: 10,
                  content: `# 👤 Perfil de Voz - ${targetUser.displayName || targetUser.username}`
                }
              ],
              accessory: {
                type: 11,
                media: {
                  url: targetUser.displayAvatarURL({ size: 128, extension: 'png' })
                },
                description: 'Avatar do usuário'
              }
            },
            {
              type: 14,
              divider: true,
              spacing: 1
            },
            {
              type: 10,
              content: `${targetUser} ainda não possui dados registrados.\nO rastreamento começa quando o usuário entra em um canal de voz.`
            }
          ]
        }
      ]
    });
  }

  const authorBalance = authorEcon ? authorEcon.voice_coins : 0;
  const payload = getLevelEmbedsAndComponents(interaction.user.id, targetUser, metrics, badges, bestFriend, 'stats', authorBalance);
  return interaction.editReply(payload);
}

export async function handleInteraction(interaction, args) {
  const [activePage, authorId, targetId] = args;

  if (interaction.user.id !== authorId) {
    return interaction.reply({
      content: '❌ Apenas o autor do comando pode navegar pelas abas.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  try {
    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!targetUser) return;

    // Se for selecionar as conquistas personalizadas
    if (activePage === 'selectBadges') {
      const { setUserSelectedBadges } = await import('../utils/userSettings.js');
      const { syncMemberNicknameBadges } = await import('../utils/lootSystem.js');

      // Salva a seleção do usuário (se selecionou 'default', limpa as customizações)
      let values = interaction.values || [];
      if (values.includes('default')) {
        values = [];
      }
      setUserSelectedBadges(authorId, values);

      // Atualiza o apelido em segundo plano (não bloqueante)
      const member = await interaction.guild.members.fetch(authorId).catch(() => null);
      if (member) {
        syncMemberNicknameBadges(member, true).catch(() => null);
      }

      // Recarrega a página de badges
      const [metrics, badges, bestFriend, authorEcon] = await Promise.all([
        getUserMetrics(targetId),
        getUserBadges(targetId),
        getBestFriend(targetId),
        getEconomy(authorId)
      ]);

      if (!metrics) return;

      const authorBalance = authorEcon ? authorEcon.voice_coins : 0;
      const payload = getLevelEmbedsAndComponents(authorId, targetUser, metrics, badges, bestFriend, 'badges', authorBalance);
      await interaction.editReply(payload);
      return;
    }

    // Se for alternar exibição das conquistas no nome
    if (activePage === 'toggleBadges') {
      const { setShowBadgesSetting, getShowBadgesSetting } = await import('../utils/userSettings.js');
      const { syncMemberNicknameBadges } = await import('../utils/lootSystem.js');

      const currentSetting = getShowBadgesSetting(targetId);
      setShowBadgesSetting(targetId, !currentSetting);

      // Atualiza o apelido do membro em segundo plano (não bloqueante)
      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (member) {
        syncMemberNicknameBadges(member, true).catch(() => null);
      }

      // Detecta qual aba estava ativa anteriormente para manter o usuário nela
      let lastActivePage = 'stats';
      const message = interaction.message;
      if (message.components && message.components[0]) {
        const buttons = message.components[0].components;
        const statsBtn = buttons[0];
        const badgesBtn = buttons[1];
        const friendBtn = buttons[2];
        const shopBtn = buttons[3];
        if (statsBtn.disabled) lastActivePage = 'stats';
        else if (badgesBtn.disabled) lastActivePage = 'badges';
        else if (friendBtn.disabled) lastActivePage = 'friend';
        else if (shopBtn.disabled) lastActivePage = 'shop';
      }

      const [metrics, badges, bestFriend, authorEcon] = await Promise.all([
        getUserMetrics(targetId),
        getUserBadges(targetId),
        getBestFriend(targetId),
        getEconomy(authorId)
      ]);

      if (!metrics) return;

      const authorBalance = authorEcon ? authorEcon.voice_coins : 0;
      const payload = getLevelEmbedsAndComponents(authorId, targetUser, metrics, badges, bestFriend, lastActivePage, authorBalance);
      await interaction.editReply(payload);
      return;
    }

    const [metrics, badges, bestFriend, authorEcon] = await Promise.all([
      getUserMetrics(targetId),
      getUserBadges(targetId),
      getBestFriend(targetId),
      getEconomy(authorId)
    ]);

    if (!metrics) return;

    const authorBalance = authorEcon ? authorEcon.voice_coins : 0;
    const payload = getLevelEmbedsAndComponents(authorId, targetUser, metrics, badges, bestFriend, activePage, authorBalance);
    await interaction.editReply(payload);
  } catch (error) {
    console.error('Erro ao processar interação em level:', error);
  }
}
