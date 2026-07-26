const {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

require('dotenv').config();

if (!process.env.TOKEN) {
  console.error('❌ TOKEN manquant dans les variables d’environnement.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  presence: {
    status: 'online',
    activities: [{ name: 'Unity RP', type: ActivityType.Playing }]
  }
});

const AUTHORIZED_USERNAME = 'ytmaxed';

const HIERARCHIE = [
  { categorie: '👑・FONDATION', roles: ['Fondateur','Fondateur Adjoint','Co-Fondateur','Secrétaire Fondation'] },
  { categorie: '💼・MEMBRES DE LA GÉRANCE', roles: ['Gérant Staff','Assistant Gérant Staff'] },
  { categorie: '⚙️・ADMINISTRATION', roles: ['Ultra Administrateur','Super Administrateur','Administrateur','Administrateur Test'] },
  { categorie: '🛡️・MODÉRATION', roles: ['Ultra Modo','Super Modérateur','Modérateur','Modérateur Test'] },
  { categorie: '🤝・AIDE', roles: ['Super Helpeur','Helpeur','Helpeur Test'] },
  { categorie: '📋・GÉRANCES SPÉCIALISÉES', roles: ['Gérant Illégal','Gérant Événement','Gérant Unban','Gérant Légal','Gérant Partenariat','Gérant RP','Gérant Builder'] },
  { categorie: '🔨・BUILD', roles: ['Builder'] },
  { categorie: '🤖・BOT', roles: ['BOT'] },
  { categorie: '📌・AUTRES RÔLES', roles: ['Équipe Staff','Server Booster','Server Boosters','Ami Fidèle','Citoyen','Citoyens'] }
];

client.once(Events.ClientReady, async readyClient => {
  console.log('✅ UNITY RP BOT CONNECTÉ');
  console.log(`🤖 Nom : ${readyClient.user.tag}`);
  console.log(`🆔 ID : ${readyClient.user.id}`);
  console.log(`🌐 Serveurs : ${readyClient.guilds.cache.size}`);

  const command = new SlashCommandBuilder()
    .setName('hierarchie')
    .setDescription('Affiche la hiérarchie complète du serveur.');

  try {
    await readyClient.application.commands.set([command.toJSON()]);
    console.log('✅ Commande /hierarchie installée.');
  } catch (error) {
    console.error('❌ Erreur installation /hierarchie :', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'hierarchie') return;

  if (interaction.user.username.toLowerCase() !== AUTHORIZED_USERNAME.toLowerCase()) {
    return interaction.reply({
      content: '❌ Vous n’êtes pas autorisé à utiliser cette commande.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply('❌ Cette commande doit être utilisée dans un serveur.');
    }

    await guild.members.fetch();

    let texte = '';

    for (const section of HIERARCHIE) {
      texte += `\n## ${section.categorie}\n\n`;

      const handledRoleIds = new Set();

      for (const roleName of section.roles) {
        const role = guild.roles.cache.find(
          r => r.name.toLowerCase() === roleName.toLowerCase()
        );

        if (!role) continue;
        if (handledRoleIds.has(role.id)) continue;
        handledRoleIds.add(role.id);

        const membres = [...role.members.values()];

        texte += `**${role.name}** — \`${membres.length} membre${membres.length > 1 ? 's' : ''}\`\n`;

        if (membres.length === 0) {
          texte += '> Aucun membre\n\n';
        } else {
          texte += `> ${membres.map(member => `<@${member.id}>`).join(' • ')}\n\n`;
        }
      }

      texte += '━━━━━━━━━━━━━━━━━━━━\n';
    }

    const morceaux = [];
    let actuel = '';

    for (const ligne of texte.split('\n')) {
      const ajout = `${ligne}\n`;

      if ((actuel + ajout).length > 3800) {
        morceaux.push(actuel);
        actuel = '';
      }

      actuel += ajout;
    }

    if (actuel.trim()) morceaux.push(actuel);

    const embeds = morceaux.slice(0, 10).map((morceau, index) => {
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setDescription(morceau);

      if (index === 0) {
        embed.setTitle('🏛️ HIÉRARCHIE OFFICIELLE DU SERVEUR');
      }

      if (index === Math.min(morceaux.length, 10) - 1) {
        embed
          .setFooter({ text: 'Hiérarchie officielle • Mise à jour automatiquement' })
          .setTimestamp();
      }

      return embed;
    });

    await interaction.editReply({
      content: '@everyone\n# 📋 HIÉRARCHIE DU SERVEUR',
      embeds,
      allowedMentions: {
        parse: ['everyone', 'users']
      }
    });
  } catch (error) {
    console.error('❌ Erreur /hierarchie :', error);

    await interaction.editReply({
      content: '❌ Une erreur est survenue pendant la création de la hiérarchie.'
    });
  }
});

client.login(process.env.TOKEN);
