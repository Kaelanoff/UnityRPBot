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

  if (!saved.guildId || saved.guildId !== guild.id || !saved.channelId || !saved.messageId) {
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
  console.log(`🔒 /config réservé à : ${AUTHORIZED_USERNAME}`);
  console.log('📢 /hierarchie publie pour @everyone');

  // Nettoie les anciennes commandes globales
  try {
    await readyClient.application.commands.set([]);
  } catch (error) {
    console.warn('⚠️ Nettoyage global :', error?.message || error);
  }

  // Commandes de serveur = mise à jour immédiate
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

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // /CONFIG = PRIVÉ + UNIQUEMENT ytmaxed
  if (interaction.commandName === 'config') {
    if (!isAuthorized(interaction.user)) {
      return interaction.reply({
        content: '❌ Cette commande est privée.',
        flags: MessageFlags.Ephemeral
      });
    }

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

  // /HIERARCHIE = SEUL ytmaxed PEUT LA LANCER,
  // MAIS LE MESSAGE EST PUBLIC ET PING @everyone.
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

      const payload = await buildHierarchyPayload(interaction.guild, true);
      const message = await interaction.editReply(payload);

      saveJson(MESSAGE_FILE, {
        guildId: interaction.guild.id,
        channelId: message.channelId,
        messageId: message.id
      });

      return;
    } catch (error) {
      console.error('❌ /hierarchie :', error);
      return interaction.editReply('❌ Une erreur est survenue.');
    }
  }
});

// Mise à jour automatique du nombre quand un rôle configuré change.
// Pas de nouveau ping @everyone lors des mises à jour.
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

client.login(process.env.TOKEN);
