// ============================================
// commands/loja.js — A Loja do Caos
// ============================================

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEconomy, spendCoins, addEconomy } from '../database.js';
import { activeTrollNicknames, botUpdatingNicks } from '../utils/lootSystem.js';

export const data = new SlashCommandBuilder()
  .setName('loja')
  .setDescription('Loja do Caos: Compre itens para zoar seus amigos na call de voz.')
  .addSubcommand(subcommand =>
    subcommand
      .setName('mordaca')
      .setDescription('🤐 (100 coins) Muta um amigo no servidor por 10 segundos.')
      .addUserOption(option => option.setName('alvo').setDescription('Quem você quer mutar').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('surdez')
      .setDescription('🔇 (150 coins) Deixa um amigo totalmente surdo no Discord por 15 segundos.')
      .addUserOption(option => option.setName('alvo').setDescription('Quem vai ficar surdo').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('chute')
      .setDescription('👢 (400 coins) Derruba um amigo da call atual.')
      .addUserOption(option => option.setName('alvo').setDescription('Quem você quer chutar').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('teleporte')
      .setDescription('🌀 (300 coins) Joga um amigo para um canal de voz aleatório.')
      .addUserOption(option => option.setName('alvo').setDescription('Quem vai ser teleportado').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('identidade')
      .setDescription('🤡 (200 coins) Troca o apelido do amigo por uma piada aleatória por 10 minutos.')
      .addUserOption(option => option.setName('alvo').setDescription('Vítima do apelido').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('trombadinha')
      .setDescription('🥷 (50 coins) Tenta roubar moedas de um amigo. 50% de chance de sucesso.')
      .addUserOption(option => option.setName('alvo').setDescription('A vítima do roubo').setRequired(true))
  );

// Nomes zoados para a troca de identidade
const TROLL_NAMES = [
  "Microfone de R$10",
  "O Caladão",
  "Gado Demais",
  "Rei do Cringe",
  "Fã de Kpop",
  "Zé da Manga",
  "Sem Microfone",
  "Mamãe mandou dormir",
  "Caçador de Borboletas"
];

const SHOP_ITEMS = {
  mordaca: { name: 'Mordaça 🤐', price: 100, desc: 'Muta um amigo no servidor por 10 segundos.' },
  surdez: { name: 'Surdez Súbita 🔇', price: 150, desc: 'Deixa um amigo totalmente surdo por 15 segundos.' },
  chute: { name: 'O Chute 👢', price: 400, desc: 'Derruba um amigo do canal de voz atual.' },
  teleporte: { name: 'Teleporte 🌀', price: 300, desc: 'Joga um amigo para um canal de voz aleatório.' },
  identidade: { name: 'Nova Identidade 🤡', price: 200, desc: 'Muda o apelido por uma piada por 10 minutos.' },
  trombadinha: { name: 'Trombadinha 🥷', price: 50, desc: 'Tenta roubar moedas de um amigo (50% de chance de sucesso).' }
};

function getSuccessPayload(text) {
  return {
    flags: 32768,
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 15680580, // 0xEF4444 (Vermelho do Caos)
        components: [
          {
            type: 10, // Text Display
            content: text
          }
        ]
      }
    ]
  };
}

function getErrorPayload(text) {
  return {
    flags: 32768,
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 15680580, // 0xEF4444
        components: [
          {
            type: 10, // Text Display
            content: `❌ ${text}`
          }
        ]
      }
    ]
  };
}

export async function execute(interaction) {
  await interaction.deferReply();

  const command = interaction.options.getSubcommand(false);
  const executor = interaction.user;

  if (command) {
    const targetUser = interaction.options.getUser('alvo');

    if (!targetUser) {
      return interaction.editReply(getErrorPayload('Mencione um alvo válido. Ex.: `/loja chute alvo:@usuario` ou `%loja chute @usuario`.'));
    }
    if (targetUser.id === executor.id) {
      return interaction.editReply(getErrorPayload('Você não pode usar itens em si mesmo, gênio.'));
    }
    if (targetUser.bot) {
      return interaction.editReply(getErrorPayload('Meus irmãos robôs são imunes aos itens humanos.'));
    }

    // Tenta buscar o alvo na Guilda para ver se ele está numa call
    const guild = interaction.guild;
    const memberTarget = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!memberTarget) {
      return interaction.editReply(getErrorPayload('Usuário não encontrado no servidor.'));
    }

    const item = SHOP_ITEMS[command];
    const price = item ? item.price : 0;

    // Verifica Saldo
    const econ = await getEconomy(executor.id);
    if (econ.voice_coins < price) {
      return interaction.editReply(getErrorPayload(`Você está pobre! Precisa de \`${price}\` moedas, mas só tem \`${econ.voice_coins}\`. Fale mais nas calls para ganhar dinheiro.`));
    }

    // Checagens prévias de conexão (exceto pra roubo e identidade)
    if (['mordaca', 'surdez', 'chute', 'teleporte'].includes(command)) {
      if (!memberTarget.voice || !memberTarget.voice.channel) {
        return interaction.editReply(getErrorPayload(`O alvo ${targetUser} não está em nenhum canal de voz! O item só funciona se ele estiver numa call.`));
      }
    }

    // Desconta o dinheiro
    const success = await spendCoins(executor.id, price);
    if (!success) {
      return interaction.editReply(getErrorPayload('Erro ao descontar suas moedas.'));
    }

    return runPurchaseExecution(interaction, command, targetUser, memberTarget, price, executor);
  }

  // Se não há subcomando, abre a loja interativa!
  try {
    const payload = await getShopPayload(executor.id);
    await interaction.editReply(payload);
  } catch (error) {
    console.error('Erro ao abrir loja interativa:', error);
    await interaction.editReply(getErrorPayload('Ocorreu um erro ao abrir a Loja do Caos.'));
  }
}

export async function getShopPayload(executorId) {
  const econ = await getEconomy(executorId);
  const balance = econ ? econ.voice_coins : 0;

  const containerComponents = [
    {
      type: 10, // TEXT DISPLAY
      content: `# 🏪 A Loja do Caos\n💰 **Seu Saldo:** \`${balance}\` Voice Coins\nEscolha um item abaixo para iniciar:`
    },
    {
      type: 14, // SEPARATOR
      divider: true,
      spacing: 1
    }
  ];

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
        custom_id: `loja:select:${key}:${executorId}`,
        label: 'Escolher',
        style: 2 // Secondary
      }
    });
  }

  return {
    flags: 32768,
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 15680580,
        components: containerComponents
      }
    ]
  };
}

async function runPurchaseExecution(interaction, command, targetUser, memberTarget, price, executor) {
  try {
    if (command === 'mordaca') {
      await memberTarget.voice.setMute(true, `Vítima de mordaça por ${executor.username}`);
      await interaction.editReply(getSuccessPayload(`🤐 **MORDAÇA!** Você pagou ${price} moedas e ${targetUser} ficará calado(a) por 10 segundos!`));
      
      setTimeout(async () => {
        try { await memberTarget.voice.setMute(false, 'Tempo da mordaça acabou'); } catch (e) {}
      }, 10000);
    }

    else if (command === 'surdez') {
      await memberTarget.voice.setDeaf(true, `Vítima de surdez por ${executor.username}`);
      await interaction.editReply(getSuccessPayload(`🔇 **SURDEZ SÚBITA!** Você pagou ${price} moedas. ${targetUser} ficou totalmente surdo(a) na call por 15 segundos! Shhh... fofoquem dele!`));
      
      setTimeout(async () => {
        try { await memberTarget.voice.setDeaf(false, 'Tempo da surdez acabou'); } catch (e) {}
      }, 15000);
    }

    else if (command === 'chute') {
      await memberTarget.voice.disconnect(`Chutado por ${executor.username}`);
      await interaction.editReply(getSuccessPayload(`👢 **O CHUTE!** Você pagou ${price} moedas! O pé virtual atingiu a bunda de ${targetUser} e ele(a) voou do canal de voz! 😂`));
    }

    else if (command === 'teleporte') {
      const guild = memberTarget.guild;
      const voiceChannels = guild.channels.cache.filter(c => 
        (c.type === 2 || c.type === 13) && c.id !== memberTarget.voice.channelId
      );
      
      if (voiceChannels.size === 0) {
        // Se não tiver pra onde mover, devolve as moedas
        await addEconomy(executor.id, executor.username, price, 0);
        return interaction.editReply(getErrorPayload(`Não há outros canais de voz disponíveis para teletransportar ${targetUser}. Moedas devolvidas.`));
      }

      const randomChannel = voiceChannels.random();
      await memberTarget.voice.setChannel(randomChannel, `Teleportado por ${executor.username}`);
      await interaction.editReply(getSuccessPayload(`🌀 **TELEPORTE!** Gastou ${price} moedas! ${targetUser} foi sugado(a) por um vórtice e parou lá no canal **${randomChannel.name}**!`));
    }

    else if (command === 'identidade') {
      if (!memberTarget.manageable) {
        await addEconomy(executor.id, executor.username, price, 0);
        return interaction.editReply(getErrorPayload(`Não tenho permissão (hierarquia) para mudar o nick de ${targetUser}. Moedas devolvidas.`));
      }

      const oldNick = memberTarget.displayName;
      const newNick = TROLL_NAMES[Math.floor(Math.random() * TROLL_NAMES.length)];
      
      const duration = 10 * 60 * 1000;
      const expiresAt = Date.now() + duration;
      
      // Registra o apelido troll na estrutura global para bloquear sincronização de conquistas
      activeTrollNicknames.set(memberTarget.id, { nickname: newNick, expiresAt, oldNickname: oldNick });
      
      try {
        botUpdatingNicks.add(memberTarget.id);
        await memberTarget.setNickname(newNick, `Vítima de Identidade por ${executor.username}`);
      } finally {
        setTimeout(() => botUpdatingNicks.delete(memberTarget.id), 3000);
      }
      
      await interaction.editReply(getSuccessPayload(`🤡 **NOVA IDENTIDADE!** Pagou ${price} moedas! Pelos próximos 10 minutos, o apelido de ${targetUser} será **${newNick}** no servidor!`));
      
      setTimeout(async () => {
        try {
          // Remove da lista de trolls ativos
          const activeTroll = activeTrollNicknames.get(memberTarget.id);
          if (activeTroll && activeTroll.nickname === newNick) {
            activeTrollNicknames.delete(memberTarget.id);
          }
          
          if (memberTarget.displayName === newNick) {
            try {
              botUpdatingNicks.add(memberTarget.id);
              await memberTarget.setNickname(oldNick, 'Trollagem acabou');
            } finally {
              setTimeout(() => botUpdatingNicks.delete(memberTarget.id), 3000);
            }
          }
        } catch (e) {
          console.error(`Erro ao expirar apelido troll de ${memberTarget.id}:`, e.message);
        }
      }, duration);
    }

    else if (command === 'trombadinha') {
      const targetEcon = await getEconomy(targetUser.id);
      
      if (targetEcon.voice_coins < 10) {
        await addEconomy(executor.id, executor.username, price, 0);
        return interaction.editReply(getErrorPayload(`${targetUser} está mais liso que você (tem menos de 10 moedas). O roubo não ia compensar. Moedas devolvidas.`));
      }

      const isSuccess = Math.random() >= 0.5;

      if (isSuccess) {
        const rouboAmount = Math.min(targetEcon.voice_coins, Math.floor(Math.random() * 41) + 10);
        
        await spendCoins(targetUser.id, rouboAmount);
        await addEconomy(executor.id, executor.username, rouboAmount, 0);

        await interaction.editReply(getSuccessPayload(`🥷 **BATEU A CARTEIRA!** Deu bom! Você pagou os 50 da taxa da gangue e conseguiu roubar \`${rouboAmount}\` moedas de ${targetUser}! Seu saldo aumentou.`));
      } else {
        await addEconomy(targetUser.id, targetUser.username || targetUser.tag, price, 0);
        
        await interaction.editReply(getSuccessPayload(`🚔 **DEU RUIM!** Você tentou bater a carteira de ${targetUser}, tropeçou e caiu de cara no chão! Você perdeu \`${price}\` moedas, e o alvo pegou elas do chão pra ele!`));
      }
    }

    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 15000);

  } catch (error) {
    console.error('❌ Erro na execução de item da loja:', error);
    await addEconomy(executor.id, executor.username, price, 0);
    return interaction.editReply(getErrorPayload(`Ocorreu um erro ao usar o item em ${targetUser} (Possível falta de permissões do bot). Suas moedas foram devolvidas.`));
  }
}

export async function handleInteraction(interaction, args) {
  const [action, ...rest] = args;

  if (action === 'select') {
    const [itemId, authorId] = rest;
    if (interaction.user.id !== authorId) {
      return interaction.reply({ content: '❌ Apenas quem abriu a loja pode selecionar itens.', ephemeral: true });
    }

    const item = SHOP_ITEMS[itemId];
    if (!item) return;

    await interaction.deferUpdate();

    const userMenu = new UserSelectMenuBuilder()
      .setCustomId(`loja:target:${itemId}:${authorId}`)
      .setPlaceholder('Escolha a vítima do item...');

    const row = new ActionRowBuilder().addComponents(userMenu);
    
    await interaction.editReply({
      flags: 32768,
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 15680580,
          components: [
            {
              type: 10, // Text Display
              content: `# 🛒 Seleção de Alvo — ${item.name}\nVocê escolheu **${item.name}** (${item.price} coins).\nSelecione o usuário alvo no menu abaixo para continuar.`
            }
          ]
        },
        row.toJSON()
      ]
    });
  }

  else if (action === 'target') {
    const [itemId, authorId] = rest;
    if (interaction.user.id !== authorId) {
      return interaction.reply({ content: '❌ Apenas quem abriu a loja pode selecionar o alvo.', ephemeral: true });
    }

    const targetUserId = interaction.values[0];
    if (targetUserId === authorId) {
      await interaction.reply({ content: '❌ Você não pode usar itens em si mesmo, gênio.', ephemeral: true });
      return;
    }

    await interaction.deferUpdate();

    const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
      return interaction.editReply(getErrorPayload('Usuário não encontrado.'));
    }

    if (targetUser.bot) {
      await interaction.editReply(getErrorPayload('Meus irmãos robôs são imunes aos itens humanos.'));
      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, 15000);
      return;
    }

    const item = SHOP_ITEMS[itemId];
    const btnConfirm = new ButtonBuilder()
      .setCustomId(`loja:buy:${itemId}:${targetUserId}:${authorId}`)
      .setLabel('Confirmar Compra')
      .setStyle(ButtonStyle.Success);

    const btnCancel = new ButtonBuilder()
      .setCustomId(`loja:cancel:${authorId}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(btnConfirm, btnCancel);
    
    await interaction.editReply({
      flags: 32768,
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 15680580,
          components: [
            {
              type: 10, // Text Display
              content: `# 📝 Confirmar Compra\nVocê está prestes a comprar **${item.name}** para usar em **${targetUser.username}**.\n\n💵 **Custo:** \`${item.price}\` Voice Coins\n\nDeseja confirmar a transação?`
            }
          ]
        },
        row.toJSON()
      ]
    });
  }

  else if (action === 'cancel') {
    const [authorId] = rest;
    if (interaction.user.id !== authorId) {
      return interaction.reply({ content: '❌ Apenas o autor da compra pode cancelar.', ephemeral: true });
    }

    await interaction.deferUpdate();
    await interaction.editReply(getErrorPayload('Compra cancelada.'));

    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 15000);
  }

  else if (action === 'buy') {
    const [itemId, targetUserId, authorId] = rest;
    if (interaction.user.id !== authorId) {
      return interaction.reply({ content: '❌ Apenas quem iniciou a compra pode confirmar.', ephemeral: true });
    }

    await interaction.deferUpdate();

    const guild = interaction.guild;
    const memberTarget = await guild.members.fetch(targetUserId).catch(() => null);
    if (!memberTarget) {
      return interaction.editReply(getErrorPayload('Usuário não encontrado no servidor.'));
    }

    const item = SHOP_ITEMS[itemId];
    const price = item ? item.price : 0;

    const econ = await getEconomy(authorId);
    if (econ.voice_coins < price) {
      return interaction.editReply(getErrorPayload(`Você está pobre! Precisa de \`${price}\` moedas, mas só tem \`${econ.voice_coins}\`.`));
    }

    if (['mordaca', 'surdez', 'chute', 'teleporte'].includes(itemId)) {
      if (!memberTarget.voice || !memberTarget.voice.channel) {
        return interaction.editReply(getErrorPayload(`O alvo ${memberTarget.user} não está em nenhum canal de voz! O item foi cancelado.`));
      }
    }

    const success = await spendCoins(authorId, price);
    if (!success) {
      return interaction.editReply(getErrorPayload('Erro ao descontar suas moedas.'));
    }

    const targetUser = memberTarget.user;
    const executor = interaction.user;
    await runPurchaseExecution(interaction, itemId, targetUser, memberTarget, price, executor);
  }
}
