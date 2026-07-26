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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

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

function isAuthorized(user) {
  return String(user.username).toLowerCase() === AUTHORIZED_USERNAME.toLowerCase();
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

async function buildHierarchyPayload(guild, pingEveryone = false) {
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
        text += `**Rôle supprimé/introuvable** — \`0 membre\`\n\n`;
        continue;
      }

      const count = role.members.size;
      text += `**${role.name}** — \`${count} membre${count > 1 ? 's' : ''}\`\n\n`;
    }

    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  }

  if (!text.trim()) {
    text = '⚠️ Aucun rôle n’est encore configuré.\n\nUtilise `/config role` pour ajouter des rôles.';
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
    content: pingEveryone
      ? '@everyone\n# 📋 HIÉRARCHIE DU SERVEUR'
      : '# 📋 HIÉRARCHIE DU SERVEUR',
    embeds,
    allowedMentions: {
      parse: pingEveryone ? ['everyone'] : []
    }
  };
}

async function updateSavedHierarchyMessage(guild) {
  const saved = loadJson(MESSAGE_FILE, {
    guildId: null,
    channelId: null,
    messageId: null
  });

  if (
    !saved.guildId ||
    saved.guildId !== guild.id ||
    !saved.channelId ||
    !saved.messageId
  ) {
    return;
  }

  try {
    const channel = await guild.channels.fetch(saved.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(saved.messageId);
    const payload = await buildHierarchyPayload(guild, false);

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
  const categoryChoices = CATEGORIES.map(category => ({
    name: category,
    value: category
  }));

  const configCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure la hiérarchie.')
    .addSubcommand(sub =>
      sub
        .setName('role')
        .setDescription('Ajoute ou déplace un rôle dans une catégorie.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Rôle à configurer')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('categorie')
            .setDescription('Catégorie')
            .setRequired(true)
            .addChoices(...categoryChoices)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('supprimer')
        .setDescription('Retire un rôle de la hiérarchie.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Rôle à retirer')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('voir')
        .setDescription('Affiche les rôles configurés.')
    )
    .addSubcommand(sub =>
      sub
        .setName('vider')
        .setDescription('Vide toute la hiérarchie.')
    );

  const hierarchyCommand = new SlashCommandBuilder()
    .setName('hierarchie')
    .setDescription('Publie la hiérarchie et active la mise à jour automatique.');

  return [configCommand.toJSON(), hierarchyCommand.toJSON()];
}

client.once(Events.ClientReady, async readyClient => {
  ensureData();

  console.log('✅ BOT CONNECTÉ');
  console.log(`🤖 ${readyClient.user.tag}`);
  console.log(`🌐 Serveurs : ${readyClient.guilds.cache.size}`);
  console.log(`🔒 Commandes réservées à : ${AUTHORIZED_USERNAME}`);

  const commands = createCommands();

  try {
    // Supprime les anciennes commandes globales qui peuvent provoquer
    // "Cette commande est obsolète".
    await readyClient.application.commands.set([]);
    console.log('🧹 Anciennes commandes globales supprimées.');
  } catch (error) {
    console.warn('⚠️ Nettoyage global non bloquant :', error?.message || error);
  }

  // Installation PAR SERVEUR = apparition quasi immédiate et pas de délai global.
  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await guild.commands.set(commands);
      console.log(`✅ Commandes installées sur : ${guild.name}`);
    } catch (error) {
      console.error(`❌ Installation commandes sur ${guild.name} :`, error);
    }
  }
});

client.on(Events.GuildCreate, async guild => {
  try {
    await guild.commands.set(createCommands());
    console.log(`✅ Commandes installées sur nouveau serveur : ${guild.name}`);
  } catch (error) {
    console.error('❌ GuildCreate commands :', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!['config', 'hierarchie'].includes(interaction.commandName)) return;

  if (!isAuthorized(interaction.user)) {
    return interaction.reply({
      content: '❌ Vous n’êtes pas autorisé à utiliser cette commande.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.commandName === 'config') {
    const sub = interaction.options.getSubcommand();
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
        content: `✅ ${role} retiré de la hiérarchie.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'voir') {
      let text = '# ⚙️ CONFIGURATION DE LA HIÉRARCHIE\n\n';

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
    await interaction.deferReply();

    try {
      if (!interaction.guild) {
        return interaction.editReply('❌ Cette commande doit être utilisée sur un serveur.');
      }

      const payload = await buildHierarchyPayload(interaction.guild, true);
      const message = await interaction.editReply(payload);

      saveJson(MESSAGE_FILE, {
        guildId: interaction.guild.id,
        channelId: message.channelId,
        messageId: message.id
      });

      console.log('✅ Message hiérarchie enregistré.');
      return;
    } catch (error) {
      console.error('❌ /hierarchie :', error);
      return interaction.editReply('❌ Une erreur est survenue pendant la création de la hiérarchie.');
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

client.login(process.env.TOKEN);
