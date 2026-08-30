// ============================================
// commands/participacao.js — Comando /participacao
// ============================================
// Relatório de participação nas calls arquivadas: distribui o
// engajamento de cada gravação (votos, comentários, cliques em ouvir)
// entre quem falou nela, proporcional ao tempo de fala, e normaliza
// num percentual sugerido de distribuição de lucro por usuário.
//
// Lida com dados financeiros/de negócio — restrito a Administradores,
// diferente do resto do arquivo (que usa CALLS_ARCHIVE_ROLE_ID).

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getParticipationReport } from '../callArchive.js';

export const data = new SlashCommandBuilder()
  .setName('participacao')
  .setDescription('Relatório de participação nas calls gravadas (percentual sugerido de distribuição de lucro).')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addIntegerOption((option) =>
    option
      .setName('dias')
      .setDescription('Período em dias (padrão: 30)')
      .setMinValue(1)
      .setMaxValue(365)
      .setRequired(false)
  )
  .addNumberOption((option) =>
    option
      .setName('lucro_total')
      .setDescription('Valor total do lucro do período, para calcular valores em vez de só percentuais')
      .setRequired(false)
  )
  .addNumberOption((option) =>
    option
      .setName('taxa')
      .setDescription('Percentual do lucro reservado para distribuição (padrão: 10%)')
      .setMinValue(0)
      .setMaxValue(100)
      .setRequired(false)
  );

export async function execute(interaction) {
  // Redundância de segurança: mesmo com setDefaultMemberPermissions, um admin
  // do servidor pode reconfigurar as permissões do comando pelo Discord — este
  // check garante que só quem realmente tem permissão de Administrador vê isso.
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Este comando é restrito a administradores.', ephemeral: true });
  }

  const dias = interaction.options.getInteger?.('dias') || 30;
  const lucroTotal = interaction.options.getNumber?.('lucro_total') ?? null;
  const taxa = interaction.options.getNumber?.('taxa') ?? 10;

  await interaction.deferReply();

  const sinceIso = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const report = await getParticipationReport(interaction.guildId, sinceIso);

  if (report.length === 0) {
    return interaction.editReply({
      content: `❌ Nenhuma participação com engajamento suficiente nos últimos ${dias} dia(s).`,
    });
  }

  const fundoDistribuido = lucroTotal !== null ? lucroTotal * (taxa / 100) : null;

  const lines = report.slice(0, 20).map((u, i) => {
    const pct = u.percent.toFixed(2);
    if (fundoDistribuido !== null) {
      const valor = fundoDistribuido * (u.percent / 100);
      return `**${i + 1}.** ${u.username} — \`${pct}%\` ≈ \`${valor.toFixed(2)}\``;
    }
    return `**${i + 1}.** ${u.username} — \`${pct}%\``;
  });

  const header =
    fundoDistribuido !== null
      ? `# 📊 Relatório de Participação (${dias} dias)\nLucro total: \`${lucroTotal}\` · Taxa: \`${taxa}%\` · Fundo distribuído: \`${fundoDistribuido.toFixed(2)}\``
      : `# 📊 Relatório de Participação (${dias} dias)\n*Informe \`lucro_total\` para ver valores estimados em vez de só percentuais.*`;

  return interaction.editReply({
    flags: 32768, // IS_COMPONENTS_V2
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 3447003,
        components: [{ type: 10, content: `${header}\n\n${lines.join('\n')}` }],
      },
    ],
  });
}
