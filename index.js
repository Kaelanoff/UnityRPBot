const {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  EmbedBuilder,
  SlashCommandBuilder,
  MessageFlags
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
    activities: [
      {
        name: 'Unity RP',
        type: ActivityType.Playing
      }
    ]
  }
});

// ======================================================
// UTILISATEUR AUTORISÉ
// ======================================================

const AUTHORIZED_USERNAME = 'ytmaxed';

// ======================================================
// HIÉRARCHIE
// ======================================================

const HIERARCHIE = [
  {
    categorie: '👑・FONDATION',
    roles: [
      'Fondateur',
      'Fondateur Adjoint',
      'Co-Fondateur',
      'Secrétaire Fondation'
    ]
  },

  {
    categorie: '💼・MEMBRES DE LA GÉRANCE',
    roles: [
      'Gérant Staff',
      'Assistant Gérant Staff'
    ]
  },

  {
    categorie: '⚙️・ADMINISTRATION',
    roles: [
      'Ultra Administrateur',
      'Super Administrateur',
      'Administrateur',
      'Administrateur Test'
    ]
  },

  {
    categorie: '🛡️・MODÉRATION',
    roles: [
      'Ultra Modo',
      'Super Modérateur',
      'Modérateur',
      'Modérateur Test'
    ]
  },

  {
    categorie: '🤝・AIDE',
    roles: [
      'Super Helpeur',
      'Helpeur',
      'Helpeur Test'
    ]
  },

  {
    categorie: '📋・GÉRANCES SPÉCIALISÉES',
    roles: [
      'Gérant Illégal',
      'Gérant Événement',
      'Gérant Unban',
      'Gérant Légal',
      'Gérant Partenariat',
      'Gérant RP',
      'Gérant Builder'
    ]
  },

  {
    categorie: '🔨・BUILD',
    roles: [
      'Builder'
    ]
  },

  {
    categorie: '🤖・BOT',
    roles: [
      'BOT'
    ]
  },

  {
    categorie: '📌・AUTRES RÔLES',
    roles: [
      'Équipe Staff',
      'Server Booster',
      'Server Boosters',
      'Ami Fidèle',
      'Citoyen',
      'Citoyens'
    ]
  }
];

// ======================================================
// BOT PRÊT
// ======================================================

client.once(Events.ClientReady, async readyClient => {
  console.log('✅ UNITY RP BOT CONNECTÉ');
  console.log(`🤖 Nom : ${readyClient.user.tag}`);
  console.log(`🆔 ID : ${readyClient.user.id}`);
  console.log(`🌐 Serveurs : ${readyClient.guilds.cache.size}`);

  const command = new SlashCommandBuilder()
    .setName('hierarchie')
    .setDescription('Affiche la hiérarchie complète du serveur.');

  try {
    await readyClient.application.commands.set([
      command.toJSON()
    ]);

    console.log('✅ Commande /hierarchie installée.');
  } catch (error) {
    console.error(
      '❌ Erreur installation /hierarchie :',
      error
    );
  }
});

// ======================================================
// COMMANDE /HIERARCHIE
// ======================================================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== 'hierarchie') return;

  // ====================================================
  // VÉRIFICATION UTILISATEUR
  // ====================================================

  if (
    interaction.user.username.toLowerCase() !==
    AUTHORIZED_USERNAME.toLowerCase()
  ) {
    return interaction.reply({
      content:
        '❌ Vous n’êtes pas autorisé à utiliser cette commande.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply();

  try {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.editReply({
        content:
          '❌ Cette commande doit être utilisée dans un serveur.'
      });
    }

    // Charge tous les membres
    await guild.members.fetch();

    let texte = '';

    // ==================================================
    // CONSTRUCTION DE LA HIÉRARCHIE
    // ==================================================

    for (const section of HIERARCHIE) {
      texte += `\n## ${section.categorie}\n\n`;

      const rolesDejaAffiches = new Set();

      for (const roleName of section.roles) {
        const role = guild.roles.cache.find(
          r =>
            r.name.toLowerCase() ===
            roleName.toLowerCase()
        );

        // Si le rôle n'existe pas, on passe au suivant
        if (!role) continue;

        // Évite certains doublons
        if (rolesDejaAffiches.has(role.id)) continue;

        rolesDejaAffiches.add(role.id);

        const membres = [
          ...role.members.values()
        ];

        const nombre = membres.length;

        texte +=
          `**${role.name}** — ` +
          `\`${nombre} membre${nombre > 1 ? 's' : ''}\`\n`;

        if (nombre === 0) {
          texte += '> Aucun membre\n\n';
        } else {
          const listeMembres = membres
            .map(
              membre =>
                `<@${membre.id}>`
            )
            .join(' • ');

          texte += `> ${listeMembres}\n\n`;
        }
      }

      texte +=
        '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    }

    // ==================================================
    // DÉCOUPE AUTOMATIQUE
    // ==================================================

    const morceaux = [];
    let morceauActuel = '';

    for (const ligne of texte.split('\n')) {
      const ajout = `${ligne}\n`;

      if (
        (morceauActuel + ajout).length >
        3800
      ) {
        morceaux.push(morceauActuel);
        morceauActuel = '';
      }

      morceauActuel += ajout;
    }

    if (morceauActuel.trim()) {
      morceaux.push(morceauActuel);
    }

    // ==================================================
    // EMBEDS
    // ==================================================

    const embeds = morceaux
      .slice(0, 10)
      .map((morceau, index) => {
        const embed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setDescription(morceau);

        if (index === 0) {
          embed.setTitle(
            '🏛️ HIÉRARCHIE OFFICIELLE DU SERVEUR'
          );
        }

        if (
          index ===
          Math.min(morceaux.length, 10) - 1
        ) {
          embed
            .setFooter({
              text:
                'Hiérarchie officielle • Mise à jour automatiquement'
            })
            .setTimestamp();
        }

        return embed;
      });

    // ==================================================
    // ENVOI
    // ==================================================

    await interaction.editReply({
      content:
        '@everyone\n# 📋 HIÉRARCHIE DU SERVEUR',
      embeds,
      allowedMentions: {
        parse: [
          'everyone',
          'users'
        ]
      }
    });

  } catch (error) {
    console.error(
      '❌ Erreur /hierarchie :',
      error
    );

    await interaction.editReply({
      content:
        '❌ Une erreur est survenue pendant la création de la hiérarchie.'
    });
  }
});

// ======================================================
// ERREURS
// ======================================================

client.on(Events.Error, error => {
  console.error(
    '❌ Erreur Discord :',
    error
  );
});

process.on(
  'unhandledRejection',
  error => {
    console.error(
      '❌ Promesse non gérée :',
      error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      '❌ Erreur non interceptée :',
      error
    );
  }
);

// ======================================================
// ARRÊT PROPRE
// ======================================================

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(
    `🛑 ${signal} reçu — arrêt propre du bot...`
  );

  try {
    client.destroy();
  } catch (error) {
    console.error(
      '❌ Erreur pendant la fermeture :',
      error
    );
  }

  process.exit(0);
}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

// ======================================================
// CONNEXION
// ======================================================

client.login(process.env.TOKEN);
