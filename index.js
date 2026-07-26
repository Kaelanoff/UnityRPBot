const fs = require('fs');
const path = require('path');

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
  console.error('❌ TOKEN manquant dans .env / Railway Variables.');
  process.exit(1);
}

const AUTHORIZED_USERNAME = 'ytmaxed';

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'hierarchie.json');
const MESSAGE_FILE = path.join(DATA_DIR, 'hierarchie-message.json');
const ACCESS_FILE = path.join(DATA_DIR, 'access.json');

const CATEGORIES = [
  '👑・FONDATION',
  '💼・MEMBRES DE LA GÉRANCE',
  '⚙️・ADMINISTRATION',
  '🛡️・MODÉRATION',
  '🤝・AIDE',
  '📋・GÉRANCES SPÉCIALISÉES',
  '🔨・BUILD',
  '🤖・BOT',
  '📌・AUTRES RÔLES'
];

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_FILE)) {
    const initial = Object.fromEntries(CATEGORIES.map(c => [c, []]));
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }

  if (!fs.existsSync(MESSAGE_FILE)) {
    fs.writeFileSync(
      MESSAGE_FILE,
      JSON.stringify({ guildId: null, channelId: null, messageId: null }, null, 2),
      'utf8'
    );
  }

  if (!fs.existsSync(ACCESS_FILE)) {
    fs.writeFileSync(
      ACCESS_FILE,
      JSON.stringify({ userIds: [] }, null, 2),
      'utf8'
    );
  }
}

function loadJson(file, fallback) {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  ensureData();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function loadHierarchy() {
  const fallback = Object.fromEntries(CATEGORIES.map(c => [c, []]));
  const data = loadJson(CONFIG_FILE, fallback);

  for (const category of CATEGORIES) {
    if (!Array.isArray(data[category])) data[category] = [];
  }

  return data;
}

function isOwner(user) {
  return String(user.username).toLowerCase() === AUTHORIZED_USERNAME.toLowerCase();
}

function loadAccess() {
  const data = loadJson(ACCESS_FILE, { userIds: [] });
  if (!Array.isArray(data.userIds)) data.userIds = [];
  return data;
}

function isAuthorized(user) {
  if (isOwner(user)) return true;
  const access = loadAccess();
  return access.userIds.includes(user.id);
}

function splitText(text, maxLength = 3800) {
  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    const add = `${line}\n`;

    if ((current + add).length > maxLength && current) {
      chunks.push(current);
      current = '';
    }

    current += add;
  }

  if (current.trim()) chunks.push(current);
  return chunks;
}

async function buildHierarchyPayload(guild) {
  await guild.members.fetch();
  await guild.roles.fetch();

  const hierarchy = loadHierarchy();
  let text = '';

  for (const category of CATEGORIES) {
    const roleIds = hierarchy[category] || [];
    if (!roleIds.length) continue;

    text += `## ${category}\n\n`;

    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);

      if (!role) {
        text += `**Rôle introuvable** — \`0 membre\`\n\n`;
        continue;
      }

      const count = role.members.size;
      text += `**${role.name}** — \`${count} membre${count > 1 ? 's' : ''}\`\n\n`;
    }

    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  }

  if (!text.trim()) {
    text = '⚠️ Aucun rôle configuré.';
  }

  const chunks = splitText(text);

  const embeds = chunks.slice(0, 10).map((chunk, index) => {
    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setDescription(chunk);

    if (index === 0) {
      embed.setTitle('🏛️ HIÉRARCHIE OFFICIELLE DU SERVEUR');
    }

    if (index === Math.min(chunks.length, 10) - 1) {
      embed
        .setFooter({ text: 'Hiérarchie officielle • Mise à jour automatique' })
        .setTimestamp();
    }

    return embed;
  });

  return {
    content: '# 📋 HIÉRARCHIE DU SERVEUR',
    embeds,
    allowedMentions: {
      parse: []
    }
  };
}

async function updateSavedHierarchyMessage(guild) {
  const saved = loadJson(MESSAGE_FILE, {
    guildId: null,
    channelId: null,
    messageId: null
  });

  if (!saved.guildId || saved.guildId !== guild.id || !saved.channelId || !saved.messageId) {
    return;
  }

  try {
    const channel = await guild.channels.fetch(saved.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(saved.messageId);
    const payload = await buildHierarchyPayload(guild);

    await message.edit(payload);
    console.log('🔄 Hiérarchie mise à jour automatiquement.');
  } catch (error) {
    console.error('❌ Mise à jour auto impossible :', error?.message || error);
  }
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

function createCommands() {
  const choices = CATEGORIES.map(category => ({
    name: category,
    value: category
  }));

  const configCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuration privée de la hiérarchie.')
    .addSubcommand(sub =>
      sub
        .setName('role')
        .setDescription('Ajoute ou déplace un rôle.')
        .addRoleOption(option =>
          option.setName('role').setDescription('Rôle').setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('categorie')
            .setDescription('Catégorie')
            .setRequired(true)
            .addChoices(...choices)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('supprimer')
        .setDescription('Retire un rôle.')
        .addRoleOption(option =>
          option.setName('role').setDescription('Rôle').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('voir').setDescription('Voir la configuration.')
    )
    .addSubcommand(sub =>
      sub.setName('vider').setDescription('Vider la configuration.')
    )
    .addSubcommandGroup(group =>
      group
        .setName('acces')
        .setDescription('Gère les personnes autorisées.')
        .addSubcommand(sub =>
          sub
            .setName('ajouter')
            .setDescription('Autorise une personne à utiliser les commandes.')
            .addUserOption(option =>
              option
                .setName('membre')
                .setDescription('Membre à autoriser')
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('retirer')
            .setDescription('Retire l’accès à une personne.')
            .addUserOption(option =>
              option
                .setName('membre')
                .setDescription('Membre à retirer')
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('voir')
            .setDescription('Affiche les personnes autorisées.')
        )
    );

  const hierarchyCommand = new SlashCommandBuilder()
    .setName('hierarchie')
    .setDescription('Publie la hiérarchie pour tout le serveur.');

  return [configCommand.toJSON(), hierarchyCommand.toJSON()];
}

client.once(Events.ClientReady, async readyClient => {
  ensureData();

  console.log('✅ BOT CONNECTÉ');
  console.log(`🤖 ${readyClient.user.tag}`);
  console.log(`🌐 Serveurs : ${readyClient.guilds.cache.size}`);
  console.log(`🔒 Propriétaire des accès : ${AUTHORIZED_USERNAME}`);
  console.log('📋 /hierarchie publie sans mention');

  try {
    await readyClient.application.commands.set([]);
    console.log('🧹 Anciennes commandes globales supprimées.');
  } catch (error) {
    console.warn('⚠️ Nettoyage global :', error?.message || error);
  }

  const commands = createCommands();

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await guild.commands.set(commands);
      console.log(`✅ Commandes installées sur ${guild.name}`);
    } catch (error) {
      console.error(`❌ Installation commandes ${guild.name} :`, error);
    }
  }
});

client.on(Events.GuildCreate, async guild => {
  try {
    await guild.commands.set(createCommands());
  } catch (error) {
    console.error('❌ Installation commandes nouveau serveur :', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'config') {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // Seul ytmaxed peut gérer qui a accès.
    if (group === 'acces') {
      if (!isOwner(interaction.user)) {
        return interaction.reply({
          content: '❌ Seul ytmaxed peut gérer les accès.',
          flags: MessageFlags.Ephemeral
        });
      }

      const access = loadAccess();

      if (sub === 'ajouter') {
        const member = interaction.options.getUser('membre', true);

        if (isOwner(member)) {
          return interaction.reply({
            content: 'ℹ️ ytmaxed a déjà toujours accès.',
            flags: MessageFlags.Ephemeral
          });
        }

        if (!access.userIds.includes(member.id)) {
          access.userIds.push(member.id);
          saveJson(ACCESS_FILE, access);
        }

        return interaction.reply({
          content: `✅ ${member} peut maintenant utiliser **/config** et **/hierarchie**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (sub === 'retirer') {
        const member = interaction.options.getUser('membre', true);
        access.userIds = access.userIds.filter(id => id !== member.id);
        saveJson(ACCESS_FILE, access);

        return interaction.reply({
          content: `✅ L’accès de ${member} a été retiré.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (sub === 'voir') {
        const lines = access.userIds.length
          ? access.userIds.map(id => `<@${id}>`).join('\n')
          : '> Aucun membre supplémentaire';

        return interaction.reply({
          content: `# 🔐 PERSONNES AUTORISÉES\n\n**Propriétaire :** ${AUTHORIZED_USERNAME}\n\n${lines}`,
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral
        });
      }
    }

    if (!isAuthorized(interaction.user)) {
      return interaction.reply({
        content: '❌ Cette commande est privée.',
        flags: MessageFlags.Ephemeral
      });
    }

    const hierarchy = loadHierarchy();

    if (sub === 'role') {
      const role = interaction.options.getRole('role', true);
      const category = interaction.options.getString('categorie', true);

      for (const cat of CATEGORIES) {
        hierarchy[cat] = (hierarchy[cat] || []).filter(id => id !== role.id);
      }

      hierarchy[category].push(role.id);
      saveJson(CONFIG_FILE, hierarchy);

      if (interaction.guild) await updateSavedHierarchyMessage(interaction.guild);

      return interaction.reply({
        content: `✅ ${role} ajouté dans **${category}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'supprimer') {
      const role = interaction.options.getRole('role', true);

      for (const cat of CATEGORIES) {
        hierarchy[cat] = (hierarchy[cat] || []).filter(id => id !== role.id);
      }

      saveJson(CONFIG_FILE, hierarchy);

      if (interaction.guild) await updateSavedHierarchyMessage(interaction.guild);

      return interaction.reply({
        content: `✅ ${role} retiré.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'voir') {
      let text = '# ⚙️ CONFIGURATION PRIVÉE\n\n';

      for (const category of CATEGORIES) {
        text += `## ${category}\n`;
        const ids = hierarchy[category] || [];
        text += ids.length
          ? `${ids.map(id => `<@&${id}>`).join('\n')}\n\n`
          : '> Aucun rôle\n\n';
      }

      return interaction.reply({
        content: text.slice(0, 1900),
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'vider') {
      const empty = Object.fromEntries(CATEGORIES.map(c => [c, []]));
      saveJson(CONFIG_FILE, empty);

      if (interaction.guild) await updateSavedHierarchyMessage(interaction.guild);

      return interaction.reply({
        content: '✅ Hiérarchie vidée.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  if (interaction.commandName === 'hierarchie') {
    if (!isAuthorized(interaction.user)) {
      return interaction.reply({
        content: '❌ Vous n’êtes pas autorisé à publier la hiérarchie.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    try {
      if (!interaction.guild) {
        return interaction.editReply('❌ Cette commande doit être utilisée sur un serveur.');
      }

      const payload = await buildHierarchyPayload(interaction.guild);
      const message = await interaction.editReply(payload);

      saveJson(MESSAGE_FILE, {
        guildId: interaction.guild.id,
        channelId: message.channelId,
        messageId: message.id
      });

      console.log('✅ Message de hiérarchie enregistré.');
      return;
    } catch (error) {
      console.error('❌ /hierarchie :', error);
      return interaction.editReply('❌ Une erreur est survenue.');
    }
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const hierarchy = loadHierarchy();
  const configuredRoleIds = new Set(Object.values(hierarchy).flat());

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const relevantChange =
    [...oldRoles.keys()].some(id => configuredRoleIds.has(id) && !newRoles.has(id)) ||
    [...newRoles.keys()].some(id => configuredRoleIds.has(id) && !oldRoles.has(id));

  if (!relevantChange) return;

  await updateSavedHierarchyMessage(newMember.guild);
});

client.on(Events.Error, error => {
  console.error('❌ Discord :', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Promesse non gérée :', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Erreur non interceptée :', error);
});

// Railway envoie SIGTERM quand il arrête/remplace un container.
// On ferme proprement Discord et on quitte avec le code 0.
let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`🛑 ${signal} reçu : arrêt propre du bot...`);

  try {
    client.destroy();
  } catch (error) {
    console.error('⚠️ Erreur pendant la fermeture Discord :', error);
  }

  setTimeout(() => process.exit(0), 250);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

client.login(process.env.TOKEN);
