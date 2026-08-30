// ============================================
// commands/conquistas.js — Comando /conquistas
// ============================================
// Exibe as estatísticas globais de raridade de todas
// as conquistas do bot, junto com as instruções de obtenção.

import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getBadgeRarityStats, getUserMetrics, getUserBadges, getBestFriend } from '../database.js';
import { LOOT_TABLE, getCurrentBadgeInfo } from '../utils/lootSystem.js';
import { getLevelEmbedsAndComponents } from './level.js';
import { getShopPayload } from './loja.js';

const BADGE_DESCRIPTIONS = {
  'coruja': 'Falar em canais de voz entre 02:00 e 05:00 da madrugada.',
  'onfire': 'Falar por mais de 5 minutos acumulados em uma mesma chamada (chance de drop ao atingir a marca).',
  'tagarela': 'Falar por mais de 2 minutos acumulados em uma mesma chamada (chance de drop ao atingir a marca).',
  'sortudo': 'Drop de chance pura ao sair da call ou parar de falar.',
  'fantasma': 'Falar durante a meia-noite (entre 00:00 e 00:59).',
  'cafe': 'Falar das 06:00 às 09:00 da manhã.',
  'orador': 'Falar por mais de 10 minutos acumulados em uma mesma chamada (chance de drop ao atingir a marca).',
  'velocista': 'Falar de forma super rápida (entre 5 e 8 segundos).',
  'sabado': 'Falar nas noites de sexta ou sábado (entre 22:00 e 03:00).',
  'maratonista': 'Permanecer por mais de 3 horas conectado em uma única chamada.',
  'ouvinte': 'Permanecer por mais de 1 hora na chamada apenas ouvindo (falou menos de 10 segundos).',
  'silencio': 'Permanecer por mais de 2 horas em silêncio absoluto (sem falar) na chamada.',
  'astrocram': 'Permanecer com a câmera ligada por mais de 30 minutos em uma única chamada.',
  'maratonistacam': 'Permanecer com a câmera ligada por mais de 1 hora em uma única chamada.',
  'discurseiro': 'Falar por mais de 2 minutos ininterruptos em um canal de voz.',
  'almoco': 'Falar nos canais de voz durante o horário de almoço (12h às 14h).',
  'sesta': 'Falar nos canais de voz durante a tarde preguiçosa (14h às 16h).',
  'segunda': 'Falar nos canais de voz em uma segunda-feira.',
  'domingo': 'Falar nos canais de voz em um domingo à noite (após 19h).',
  'metralhadora': 'Dar várias falas curtas e rápidas em sequência (entre 5s e 12s).',
  'equilibrista': 'Manter uma fala equilibrada e contínua entre 30 e 60 segundos.',
  'noturno': 'Passar mais de 10 minutos conectado em chamadas após as 23h.',
  'streamer': 'Ficar mais de 2 horas conectado na chamada e pelo menos 1 hora com a câmera ativa.',
  'workaholic': 'Falar nos canais de voz em horário comercial de dias úteis (9h às 18h).'
};

export const data = new SlashCommandBuilder()
  .setName('conquistas')
  .setDescription('Exibe as estatísticas de raridade das conquistas e como ganhar cada uma.');

function getConquistasPayload(authorId, selectedValue, rarityStats, username, avatarURL) {
  const totalDrops = Object.values(rarityStats).reduce((sum, val) => sum + val, 0) || 1;
  const containerComponents = [];

  if (!selectedValue || selectedValue === 'general') {
    containerComponents.push({
      type: 10, // Text Display
      content: `# 🏆 Guia de Conquistas e Raridade (Loot Drops)\nAqui estão todas as conquistas secretas que você pode dropar enquanto fala nos canais de voz, as regras de evolução de apelido e a frequência global delas no servidor.\n\n*Total de conquistas concedidas no servidor: \`${totalDrops}\`*`
    });

    containerComponents.push({
      type: 14, // Separator
      divider: true,
      spacing: 1
    });

    const chunkSize = 12;
    for (let i = 0; i < LOOT_TABLE.length; i += chunkSize) {
      const chunk = LOOT_TABLE.slice(i, i + chunkSize);
      let content = '';

      for (const loot of chunk) {
        const count = rarityStats[loot.name] || 0;
        const percentage = ((count / totalDrops) * 100).toFixed(1);
        content += `${loot.icon} **${loot.name}** — \`${count}\` drops (~${percentage}%)\n`;
      }

      containerComponents.push({
        type: 10, // Text Display
        content: content.trim()
      });
    }

    containerComponents.push({
      type: 10, // Text Display
      content: '*Selecione uma conquista no menu abaixo para ver a descrição completa, como obter e os níveis de evolução.*'
    });
  } else {
    const loot = LOOT_TABLE.find(l => l.id === selectedValue);
    if (loot) {
      const count = rarityStats[loot.name] || 0;
      const percentage = ((count / totalDrops) * 100).toFixed(1);
      const desc = BADGE_DESCRIPTIONS[loot.id] || 'Condição desconhecida.';

      const t1 = loot.icon;
      const t2 = loot.evolutions[0].icon;
      const t3 = loot.evolutions[1].icon;

      containerComponents.push(
        {
          type: 10,
          content: `## ${loot.icon} Detalhes da Conquista: ${loot.name}\n💡 **Regra de Obtenção:**\n${desc}`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `### ⭐ Nível Base (Tier 1)\nÍcone: ${t1}\nNome: **${loot.name}**\nRequisito: Obter a conquista 1 vez.\n\n` +
            `### 🌟 Nível Intermediário (Tier 2)\nÍcone: ${t2}\nNome: **${loot.evolutions[0].name}**\nRequisito: Acumular 5 drops desta conquista.\n\n` +
            `### 🌌 Nível Divino (Tier 3)\nÍcone: ${t3}\nNome: **${loot.evolutions[1].name}**\nRequisito: Acumular 10 drops desta conquista.`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `### 📊 Raridade e Estatísticas\n🔹 Total de drops no servidor: \`${count}\` vezes.\n🔹 Frequência global: \`${percentage}%\` de todos os drops.`
        }
      );
    }
  }

  // Cria o menu de seleção
  const menuOptions = [
    {
      label: 'Guia Geral (Resumo)',
      description: 'Volta para a lista resumida de todas as conquistas.',
      value: 'general',
      emoji: '🏆'
    },
    ...LOOT_TABLE.map(loot => {
      const desc = BADGE_DESCRIPTIONS[loot.id] || 'Condição especial de voz.';
      return {
        label: loot.name,
        description: desc.substring(0, 100),
        value: loot.id,
        emoji: loot.icon
      };
    })
  ];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`conquistas:select:${authorId}`)
    .setPlaceholder('Selecione uma conquista para ver detalhes...')
    .addOptions(menuOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  return {
    flags: 32768, // IS_COMPONENTS_V2
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 9133302, // 0x8B5CF6
        components: containerComponents
      },
      row.toJSON()
    ]
  };
}

export async function execute(interaction) {
  await interaction.deferReply();

  try {
    const rarityStats = await getBadgeRarityStats();
    const payload = getConquistasPayload(
      interaction.user.id,
      'general',
      rarityStats,
      interaction.user.username,
      interaction.user.displayAvatarURL({ size: 32 })
    );

    await interaction.editReply(payload);
  } catch (error) {
    console.error('Erro ao executar /conquistas:', error);
    await interaction.editReply({
      content: '❌ Ocorreu um erro ao carregar as estatísticas das conquistas.'
    });
  }
}

export function getBadgesListPayload(targetUser, badges) {
  let badgesDisplay = 'Nenhuma conquista desbloqueada ainda. Fale mais para dropar loot!';
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

      if (data.count > 1) {
        return `• ${displayIcon} **${displayName}** (x${data.count})`;
      }
      return `• ${displayIcon} **${displayName}**`;
    }).join('\n');
  }

  const containerComponents = [
    {
      type: 10, // Text Display
      content: `# 🎒 Inventário de Conquistas - ${targetUser.displayName || targetUser.username}\nConquistas obtidas nos canais de voz:\n\n${badgesDisplay}`
    }
  ];

  return {
    flags: 32768, // IS_COMPONENTS_V2
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 9133302, // 0x8B5CF6
        components: containerComponents
      }
    ]
  };
}

export async function handleInteraction(interaction, args) {
  const [action, authorId] = args;

  // Se for ação dos botões ou do select das conquistas de drop
  if (action === 'announce_select' || action === 'announce_btn') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const winnerId = authorId; // Neste caso, o segundo argumento é o ID do ganhador
      const choice = action === 'announce_select' ? interaction.values[0] : args[2];
      const clickerId = interaction.user.id;

      if (choice === 'my_profile') {
        const [metrics, badges, bestFriend] = await Promise.all([
          getUserMetrics(clickerId),
          getUserBadges(clickerId),
          getBestFriend(clickerId)
        ]);

        if (!metrics) {
          return interaction.editReply({
            content: '❌ Você ainda não possui perfil de voz. Entre em um canal de voz para começar!'
          });
        }
        const payload = getLevelEmbedsAndComponents(clickerId, interaction.user, metrics, badges, bestFriend, 'stats');
        return interaction.editReply(payload);
      }

      else if (choice === 'my_badges') {
        const badges = await getUserBadges(clickerId);
        const payload = getBadgesListPayload(interaction.user, badges);
        return interaction.editReply(payload);
      }

      else if (choice === 'winner_profile') {
        const winner = await interaction.client.users.fetch(winnerId).catch(() => null);
        if (!winner) {
          return interaction.editReply({ content: '❌ Não foi possível encontrar o perfil do vencedor.' });
        }
        const [metrics, badges, bestFriend] = await Promise.all([
          getUserMetrics(winnerId),
          getUserBadges(winnerId),
          getBestFriend(winnerId)
        ]);
        if (!metrics) {
          return interaction.editReply({ content: '❌ O vencedor ainda não possui dados registrados.' });
        }
        const payload = getLevelEmbedsAndComponents(clickerId, winner, metrics, badges, bestFriend, 'stats');
        return interaction.editReply(payload);
      }

      else if (choice === 'winner_badges') {
        const winner = await interaction.client.users.fetch(winnerId).catch(() => null);
        if (!winner) {
          return interaction.editReply({ content: '❌ Não foi possível encontrar o inventário do vencedor.' });
        }
        const badges = await getUserBadges(winnerId);
        const payload = getBadgesListPayload(winner, badges);
        return interaction.editReply(payload);
      }

      else if (choice === 'guide') {
        const rarityStats = await getBadgeRarityStats();
        const payload = getConquistasPayload(
          clickerId,
          'general',
          rarityStats,
          interaction.user.username,
          interaction.user.displayAvatarURL({ size: 32 })
        );
        return interaction.editReply(payload);
      }

      else if (choice === 'shop') {
        const payload = await getShopPayload(clickerId);
        return interaction.editReply(payload);
      }
    } catch (err) {
      console.error('Erro ao processar interação de anúncio:', err);
      return interaction.editReply({ content: '❌ Ocorreu um erro ao processar esta ação.' }).catch(() => null);
    }
    return;
  }

  // Comportamento padrão para o comando /conquistas tradicional
  if (interaction.user.id !== authorId) {
    return interaction.reply({
      content: '❌ Apenas quem usou o comando pode interagir com o menu.',
      ephemeral: true
    });
  }

  if (action === 'select') {
    await interaction.deferUpdate();
    try {
      const selectedValue = interaction.values[0];
      const rarityStats = await getBadgeRarityStats();
      const payload = getConquistasPayload(
        authorId,
        selectedValue,
        rarityStats,
        interaction.user.username,
        interaction.user.displayAvatarURL({ size: 32 })
      );

      await interaction.editReply(payload);
    } catch (error) {
      console.error('Erro ao processar interação em conquistas:', error);
    }
  }
}
