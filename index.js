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
  console.error('❌ TOKEN manquant dans .env');
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
    const initial = {};
    for (const category of CATEGORIES) initial[category] = [];
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }

  if (!fs.existsSync(MESSAGE_FILE)) {
    fs.writeFileSync(
      MESSAGE_FILE,
      JSON.stringify({ channelId: null, messageId: null }, null, 2),
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
  const fallback = {};
  for (const category of CATEGORIES) fallback[category] = [];

  const parsed = loadJson(CONFIG_FILE, fallback);

  for (const category of CATEGORIES) {
    if (!Array.isArray(parsed[category])) parsed[category] = [];
  }

  return parsed;
}

function saveHierarchy(data) {
  saveJson(CONFIG_FILE, data);
}

function isAuthorized(user) {
  return user.username.toLowerCase() === AUTHORIZED_USERNAME.toLowerCase();
}

function splitText(text, maxLength = 3800) {
  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    const next = `${line}\n`;

    if ((current + next).length > maxLength && current) {
      chunks.push(current);
      current = '';
    }

    current += next;
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
    const roleIds = hierarchy[category];
    if (!roleIds || roleIds.length === 0) continue;

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
    text = '⚠️ Aucun rôle n’est encore configuré.';
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
  const saved = loadJson(MESSAGE_FILE, { channelId: null, messageId: null });

  if (!saved.channelId || !saved.messageId) return;

  try {
    const channel = await guild.channels.fetch(saved.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(saved.messageId);
    const payload = await buildHierarchyPayload(guild, false);

    await message.edit(payload);
    console.log('🔄 Hiérarchie mise à jour automatiquement.');
  } catch (error) {
    console.error('❌ Impossible de mettre à jour la hiérarchie :', error);
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

client.once(Events.ClientReady, async readyClient => {
  ensureData();

  console.log('✅ UNITY RP BOT CONNECTÉ');
  console.log(`🤖 ${readyClient.user.tag}`);
  console.log(`🔒 Commandes réservées à : ${AUTHORIZED_USERNAME}`);

  const categoryChoices = CATEGORIES.map(category => ({
    name: category,
    value: category
  }));

  const configCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure la hiérarchie.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('role')
        .setDescription('Ajoute ou déplace un rôle dans la hiérarchie.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Le rôle à configurer.')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('categorie')
            .setDescription('La catégorie du rôle.')
            .setRequired(true)
            .addChoices(...categoryChoices)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('supprimer')
        .setDescription('Supprime un rôle de la hiérarchie.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Le rôle à supprimer.')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('voir')
        .setDescription('Affiche la configuration actuelle.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('vider')
        .setDescription('Vide toute la hiérarchie.')
    );

  const hierarchyCommand = new SlashCommandBuilder()
    .setName('hierarchie')
    .setDescription('Publie la hiérarchie et active la mise à jour automatique.');

  try {
    await readyClient.application.commands.set([
      configCommand.toJSON(),
      hierarchyCommand.toJSON()
    ]);
    console.log('✅ Commandes /config et /hierarchie installées.');
  } catch (error) {
    console.error('❌ Erreur installation commandes :', error);
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
    const subcommand = interaction.options.getSubcommand();
    const hierarchy = loadHierarchy();

    if (subcommand === 'role') {
      const role = interaction.options.getRole('role', true);
      const category = interaction.options.getString('categorie', true);

      for (const cat of CATEGORIES) {
        hierarchy[cat] = hierarchy[cat].filter(id => id !== role.id);
      }

      hierarchy[category].push(role.id);
      saveHierarchy(hierarchy);

      if (interaction.guild) {
        await updateSavedHierarchyMessage(interaction.guild);
      }

      return interaction.reply({
        content: `✅ ${role} est maintenant dans **${category}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (subcommand === 'supprimer') {
      const role = interaction.options.getRole('role', true);

      for (const cat of CATEGORIES) {
        hierarchy[cat] = hierarchy[cat].filter(id => id !== role.id);
      }

      saveHierarchy(hierarchy);

      if (interaction.guild) {
        await updateSavedHierarchyMessage(interaction.guild);
      }

      return interaction.reply({
        content: `✅ ${role} a été supprimé de la hiérarchie.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (subcommand === 'voir') {
      let text = '# ⚙️ CONFIGURATION DE LA HIÉRARCHIE\n\n';

      for (const category of CATEGORIES) {
        text += `## ${category}\n`;

        if (!hierarchy[category].length) {
          text += '> Aucun rôle\n\n';
        } else {
          text += hierarchy[category]
            .map(id => `<@&${id}>`)
            .join('\n') + '\n\n';
        }
      }

      return interaction.reply({
        content: text.slice(0, 1900),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'vider') {
      const empty = {};
      for (const category of CATEGORIES) empty[category] = [];

      saveHierarchy(empty);

      if (interaction.guild) {
        await updateSavedHierarchyMessage(interaction.guild);
      }

      return interaction.reply({
        content: '✅ Hiérarchie vidée.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  if (interaction.commandName === 'hierarchie') {
    await interaction.deferReply();

    try {
      const payload = await buildHierarchyPayload(interaction.guild, true);
      const message = await interaction.editReply(payload);

      saveJson(MESSAGE_FILE, {
        channelId: message.channelId,
        messageId: message.id
      });

      console.log('✅ Message de hiérarchie enregistré.');
    } catch (error) {
      console.error('❌ Erreur /hierarchie :', error);

      await interaction.editReply({
        content: '❌ Une erreur est survenue.'
      });
    }
  }
});

// Mise à jour automatique dès qu’un rôle configuré est ajouté ou retiré.
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
