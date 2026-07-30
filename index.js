const fs = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  EmbedBuilder,
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');

require('dotenv').config();

if (!process.env.TOKEN) {
  console.error('âŒ TOKEN manquant dans .env / Railway Variables.');
  process.exit(1);
}

const OWNER_USERNAME = 'ytmaxed';

// Stockage persistant Railway.
// Ton volume doit Ãªtre montÃ© exactement sur /data.
// Tu peux aussi dÃ©finir DATA_DIR dans Railway si tu changes le chemin plus tard.
const DATA_DIR = process.env.DATA_DIR || '/data';
const HIERARCHY_FILE = path.join(DATA_DIR, 'hierarchie.json');
const HIERARCHY_MESSAGE_FILE = path.join(DATA_DIR, 'hierarchie-message.json');
const ACCESS_FILE = path.join(DATA_DIR, 'access.json');
const TICKET_CONFIG_FILE = path.join(DATA_DIR, 'ticket-config.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');

const HIERARCHY_CATEGORIES = [
  'ðŸ‘‘ãƒ»FONDATION',
  'ðŸ’¼ãƒ»MEMBRES DE LA GÃ‰RANCE',
  'âš™ï¸ãƒ»ADMINISTRATION',
  'ðŸ›¡ï¸ãƒ»MODÃ‰RATION',
  'ðŸ¤ãƒ»AIDE',
  'ðŸ“‹ãƒ»GÃ‰RANCES SPÃ‰CIALISÃ‰ES',
  'ðŸ”¨ãƒ»BUILD',
  'ðŸ¤–ãƒ»BOT',
  'ðŸ“Œãƒ»AUTRES RÃ”LES'
];

const STAFF_HANDLED_TICKET_TYPES = new Set([
  'question_rc',
  'question',
  'partenariat'
]);

const TICKET_TYPES = {
  plainte_staff: {
    prefix: 'PL',
    emoji: 'ðŸ”',
    label: 'Plainte Staff',
    description: 'Signaler confidentiellement un membre du staff.',
    color: 0xED4245
  },
  question_rc: {
    prefix: 'RC',
    emoji: 'ðŸ“‹',
    label: 'Question RC Staff',
    description: 'Question sur le rÃ¨glement ou les procÃ©dures staff.',
    color: 0x5865F2
  },
  question: {
    prefix: 'QST',
    emoji: 'â“',
    label: 'Question gÃ©nÃ©rale',
    description: 'Poser une question concernant Unity RP.',
    color: 0x57F287
  },
  fondation: {
    prefix: 'FND',
    emoji: 'ðŸ‘‘',
    label: 'Contacter la Fondation',
    description: 'Envoyer une demande directement Ã  la Fondation.',
    color: 0xFEE75C
  },
  partenariat: {
    prefix: 'PART',
    emoji: 'ðŸ¤',
    label: 'Partenariat',
    description: 'Demande ou question concernant un partenariat.',
    color: 0xEB459E
  }
};

function ensureData() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // VÃ©rifie que le volume est rÃ©ellement accessible en Ã©criture.
    const testFile = path.join(DATA_DIR, '.write-test');
    fs.writeFileSync(testFile, String(Date.now()), 'utf8');
    fs.unlinkSync(testFile);
  } catch (error) {
    console.error(`âŒ Impossible dâ€™Ã©crire dans le stockage persistant ${DATA_DIR}.`);
    console.error('âŒ VÃ©rifie que le volume Railway est montÃ© sur /data.');
    console.error(error);
    process.exit(1);
  }

  const defaults = [
    [HIERARCHY_FILE, Object.fromEntries(HIERARCHY_CATEGORIES.map(c => [c, []]))],
    [HIERARCHY_MESSAGE_FILE, { guildId: null, channelId: null, messageId: null }],
    [ACCESS_FILE, { userIds: [] }],
    [TICKET_CONFIG_FILE, {
      panelChannelId: null,
      ticketCategoryId: null,
      logsChannelId: null,
      panelMessageId: null
    }],
    [TICKETS_FILE, { counter: 0, tickets: {} }]
  ];

  for (const [file, value] of defaults) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    }
  }
}

function readJson(file, fallback) {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureData();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function isOwner(user) {
  return normalize(user.username) === normalize(OWNER_USERNAME);
}

function getAccessData() {
  const data = readJson(ACCESS_FILE, { userIds: [] });
  if (!Array.isArray(data.userIds)) data.userIds = [];
  return data;
}

function isConfigAuthorized(user) {
  return isOwner(user) || getAccessData().userIds.includes(user.id);
}

function getHierarchy() {
  const fallback = Object.fromEntries(HIERARCHY_CATEGORIES.map(c => [c, []]));
  const data = readJson(HIERARCHY_FILE, fallback);
  for (const category of HIERARCHY_CATEGORIES) {
    if (!Array.isArray(data[category])) data[category] = [];
  }
  return data;
}

function getTicketConfig() {
  return readJson(TICKET_CONFIG_FILE, {
    panelChannelId: null,
    ticketCategoryId: null,
    logsChannelId: null,
    panelMessageId: null
  });
}

function getTicketsData() {
  const data = readJson(TICKETS_FILE, { counter: 0, tickets: {} });
  if (!Number.isInteger(data.counter)) data.counter = 0;
  if (!data.tickets || typeof data.tickets !== 'object') data.tickets = {};
  return data;
}

function getRoleByName(guild, expectedName) {
  const expected = normalize(expectedName);

  // Cherche d'abord le nom exact, puis accepte les dÃ©corations/Ã©mojis autour du nom.
  return guild.roles.cache.find(role => normalize(role.name) === expected) ||
    guild.roles.cache.find(role => normalize(role.name).includes(expected)) ||
    null;
}

function getRolesAtOrAbove(guild, baseRoleName) {
  const baseRole = getRoleByName(guild, baseRoleName);
  if (!baseRole) return [];

  return guild.roles.cache
    .filter(role =>
      role.id !== guild.id &&
      !role.managed &&
      role.position >= baseRole.position
    )
    .sort((a, b) => b.position - a.position)
    .map(role => role);
}

function getFoundationRoles(guild) {
  const keywords = [
    'fondation',
    'fondateur',
    'co-fondateur',
    'co fondateur',
    'secretaire fondation'
  ];

  return guild.roles.cache
    .filter(role =>
      role.id !== guild.id &&
      !role.managed &&
      keywords.some(keyword => normalize(role.name).includes(normalize(keyword)))
    )
    .map(role => role);
}

function hasRoleAtOrAbove(member, baseRoleName) {
  const baseRole = getRoleByName(member.guild, baseRoleName);
  if (!baseRole) return false;
  return member.roles.cache.some(role => role.position >= baseRole.position);
}

function isTicketManager(member) {
  return Boolean(
    member &&
    (
      isConfigAuthorized(member.user) ||
      hasRoleAtOrAbove(member, 'GÃ©rant Staff')
    )
  );
}

function channelSlug(value) {
  const slug = normalize(value)
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/[ _]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 45);

  return slug || 'utilisateur';
}

function ticketChannelName(typeKey, username) {
  const owner = channelSlug(username);

  const prefixes = {
    plainte_staff: 'plainte-staff',
    question_rc: 'question-rc',
    question: 'question',
    fondation: 'fondation',
    partenariat: 'partenariat'
  };

  return `${prefixes[typeKey] || 'ticket'}-${owner}`.slice(0, 100);
}

function ticketOwnerName(ticket) {
  return ticket.ownerUsername || `utilisateur-${String(ticket.ownerId).slice(-4)}`;
}

function nextReference(typeKey) {
  const data = getTicketsData();
  data.counter += 1;
  writeJson(TICKETS_FILE, data);

  const padded = String(data.counter).padStart(4, '0');
  return `${TICKET_TYPES[typeKey].prefix}-${padded}`;
}

function buildPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle('ðŸŽ« CENTRE Dâ€™ASSISTANCE â€” UNITY RP')
    .setDescription(
      'Bienvenue dans le centre dâ€™assistance officiel de **Unity RP**.\n\n' +
      'SÃ©lectionnez ci-dessous la catÃ©gorie correspondant Ã  votre demande. ' +
      'Un formulaire adaptÃ© sâ€™ouvrira automatiquement.'
    )
    .addFields(
      Object.values(TICKET_TYPES).map(type => ({
        name: `${type.emoji} ${type.label}`,
        value: type.description,
        inline: false
      }))
    )
    .setFooter({ text: 'Unity RP â€¢ Un seul ticket par catÃ©gorie et par membre' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:type')
    .setPlaceholder('Choisissez une catÃ©gorie')
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value, type]) => ({
        label: type.label,
        description: type.description.slice(0, 100),
        value,
        emoji: type.emoji
      }))
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
    allowedMentions: { parse: [] }
  };
}

function modalField(id, label, style = TextInputStyle.Short, required = true, maxLength = 1000, placeholder = null) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);

  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(input);
}

function buildTicketModal(typeKey, concernedUserId = null) {
  const type = TICKET_TYPES[typeKey];
  const suffix = concernedUserId ? `:${concernedUserId}` : '';
  const modal = new ModalBuilder()
    .setCustomId(`ticket:modal:${typeKey}${suffix}`)
    .setTitle(type.label.slice(0, 45));

  if (typeKey === 'plainte_staff') {
    modal.addComponents(
      modalField('motif', 'Raison de la plainte', TextInputStyle.Short, true, 200),
      modalField('description', 'Description complÃ¨te des faits', TextInputStyle.Paragraph, true, 1800),
      modalField('date', 'Date et heure approximatives', TextInputStyle.Short, true, 100),
      modalField('preuves', 'Preuves disponibles', TextInputStyle.Paragraph, false, 1000, 'Liens, captures, vidÃ©os, tÃ©moinsâ€¦')
    );
  }

  if (typeKey === 'question_rc') {
    modal.addComponents(
      modalField('sujet', 'Sujet de la question', TextInputStyle.Short, true, 150),
      modalField('regle', 'RÃ¨gle ou procÃ©dure concernÃ©e', TextInputStyle.Short, true, 200),
      modalField('question', 'Question complÃ¨te', TextInputStyle.Paragraph, true, 1800),
      modalField('contexte', 'Contexte de la situation', TextInputStyle.Paragraph, true, 1200),
      modalField('complement', 'Informations supplÃ©mentaires', TextInputStyle.Paragraph, false, 700)
    );
  }

  if (typeKey === 'question') {
    modal.addComponents(
      modalField('sujet', 'Sujet', TextInputStyle.Short, true, 150),
      modalField('question', 'Question complÃ¨te', TextInputStyle.Paragraph, true, 1800),
      modalField('contexte', 'Contexte supplÃ©mentaire', TextInputStyle.Paragraph, false, 1000)
    );
  }

  if (typeKey === 'fondation') {
    modal.addComponents(
      modalField('sujet', 'Sujet', TextInputStyle.Short, true, 150),
      modalField('motif', 'Motif du contact', TextInputStyle.Short, true, 200),
      modalField('message', 'Message complet', TextInputStyle.Paragraph, true, 1800),
      modalField('priorite', 'PrioritÃ© : Normal, Important ou Urgent', TextInputStyle.Short, true, 30)
    );
  }

  if (typeKey === 'partenariat') {
    modal.addComponents(
      modalField('serveur', 'Nom du serveur', TextInputStyle.Short, true, 150),
      modalField('lien', 'Lien Discord du serveur', TextInputStyle.Short, true, 250, 'https://discord.gg/...'),
      modalField('membres', 'Nombre de membres', TextInputStyle.Short, true, 50),
      modalField('description', 'Description du serveur', TextInputStyle.Paragraph, true, 1200),
      modalField('proposition', 'Proposition de partenariat', TextInputStyle.Paragraph, true, 1200)
    );
  }

  return modal;
}

function controlRows(ticket) {
  const claim = new ButtonBuilder()
    .setCustomId('ticket:claim')
    .setLabel(ticket.claimedBy ? 'DÃ©jÃ  pris en charge' : 'Prendre en charge')
    .setEmoji('ðŸ“—')
    .setStyle(ticket.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(Boolean(ticket.claimedBy));

  const release = new ButtonBuilder()
    .setCustomId('ticket:release')
    .setLabel('LibÃ©rer')
    .setEmoji('ðŸ“˜')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!ticket.claimedBy);

  const add = new ButtonBuilder()
    .setCustomId('ticket:add_member')
    .setLabel('Ajouter un membre')
    .setEmoji('ðŸ‘¥')
    .setStyle(ButtonStyle.Secondary);

  const remove = new ButtonBuilder()
    .setCustomId('ticket:remove_member')
    .setLabel('Retirer un membre')
    .setEmoji('ðŸ‘¤')
    .setStyle(ButtonStyle.Secondary);

  const transcript = new ButtonBuilder()
    .setCustomId('ticket:transcript')
    .setLabel('Transcription')
    .setEmoji('ðŸ“')
    .setStyle(ButtonStyle.Secondary);

  const close = new ButtonBuilder()
    .setCustomId('ticket:close')
    .setLabel('Fermer')
    .setEmoji('ðŸ”’')
    .setStyle(ButtonStyle.Danger);

  return [
    new ActionRowBuilder().addComponents(claim, release, add, remove),
    new ActionRowBuilder().addComponents(transcript, close)
  ];
}

function fieldValue(interaction, id) {
  try {
    return interaction.fields.getTextInputValue(id).trim();
  } catch {
    return '';
  }
}

function displayFieldName(id) {
  const names = {
    motif: 'Motif',
    description: 'Description',
    date: 'Date et heure',
    preuves: 'Preuves',
    sujet: 'Sujet',
    regle: 'RÃ¨gle ou procÃ©dure',
    question: 'Question',
    contexte: 'Contexte',
    complement: 'Informations supplÃ©mentaires',
    message: 'Message',
    priorite: 'PrioritÃ©',
    serveur: 'Nom du serveur',
    lien: 'Lien Discord',
    membres: 'Nombre de membres',
    proposition: 'Proposition'
  };
  return names[id] || id;
}

function buildTicketEmbeds(ticket) {
  const type = TICKET_TYPES[ticket.type];
  const info = new EmbedBuilder()
    .setColor(type.color)
    .setTitle(`${type.emoji} ${type.label.toUpperCase()} â€” ${ticketOwnerName(ticket)}`)
    .setDescription(
      `**CrÃ©ateur :** <@${ticket.ownerId}>\n` +
      `**Statut :** ${ticket.claimedBy ? 'En cours de traitement' : 'En attente'}\n` +
      `**Responsable :** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Aucun'}`
    )
    .setTimestamp(ticket.createdAt)
    .addFields({
      name: 'RÃ©fÃ©rence interne',
      value: ticket.reference,
      inline: true
    });

  if (ticket.concernedUserId) {
    info.addFields({
      name: 'Personne concernÃ©e',
      value: `<@${ticket.concernedUserId}>`,
      inline: false
    });
  }

  for (const [key, value] of Object.entries(ticket.formData || {})) {
    if (!value) continue;
    info.addFields({
      name: displayFieldName(key),
      value: String(value).slice(0, 1024),
      inline: false
    });
  }

  if (ticket.type === 'plainte_staff') {
    info.addFields({
      name: 'ðŸ” ConfidentialitÃ©',
      value:
        'Visible uniquement par le crÃ©ateur, la GÃ©rance autorisÃ©e et la Fondation. ' +
        'La personne concernÃ©e est explicitement exclue.',
      inline: false
    });
  }

  const controls = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle('ðŸ§­ CENTRE DE CONTRÃ”LE')
    .setDescription(
      'ðŸ“— **Prendre en charge** â€” rÃ©server le dossier\n' +
      'ðŸ“˜ **LibÃ©rer** â€” rendre le dossier disponible\n' +
      'ðŸ‘¥ **Ajouter un membre** â€” donner un accÃ¨s temporaire\n' +
      'ðŸ‘¤ **Retirer un membre** â€” retirer un accÃ¨s temporaire\n' +
      'ðŸ“ **Transcription** â€” gÃ©nÃ©rer lâ€™historique\n' +
      'ðŸ”’ **Fermer** â€” clÃ´turer le dossier'
    )
    .setFooter({ text: 'Unity RP â€¢ Les actions sont enregistrÃ©es' });

  return [info, controls];
}

async function sendTicketLog(guild, embed, files = []) {
  const config = getTicketConfig();
  if (!config.logsChannelId) return;

  try {
    const channel = await guild.channels.fetch(config.logsChannelId);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [embed],
        files,
        allowedMentions: { parse: [] }
      });
    }
  } catch (error) {
    console.error('âŒ Log ticket impossible :', error?.message || error);
  }
}

function buildPermissionOverwrites(guild, ownerId, typeKey, concernedUserId = null) {
  const botUserId = guild.members.me?.id || client.user?.id;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];

  // TrÃ¨s important : le bot doit garder un accÃ¨s individuel au salon.
  // Sinon le refus de @everyone peut aussi lui masquer le ticket juste aprÃ¨s sa crÃ©ation.
  if (botUserId) {
    overwrites.push({
      id: botUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  let allowedRoles = [];

  if (typeKey === 'plainte_staff') {
    allowedRoles = [
      ...getRolesAtOrAbove(guild, 'GÃ©rant Staff'),
      ...getFoundationRoles(guild)
    ];
  } else if (typeKey === 'fondation') {
    allowedRoles = getFoundationRoles(guild);
  } else {
    allowedRoles = getRolesAtOrAbove(guild, 'Ã‰quipe Staff');
  }

  const seen = new Set();
  for (const role of allowedRoles) {
    if (seen.has(role.id)) continue;
    seen.add(role.id);

    overwrites.push({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  for (const userId of getAccessData().userIds) {
    overwrites.push({
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  if (concernedUserId) {
    overwrites.push({
      id: concernedUserId,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  return overwrites;
}

function canHandleTicket(member, ticket) {
  if (!member) return false;
  if (ticket.concernedUserId === member.id) return false;
  if (isConfigAuthorized(member.user)) return true;

  if (ticket.type === 'plainte_staff') {
    return hasRoleAtOrAbove(member, 'GÃ©rant Staff') ||
      getFoundationRoles(member.guild).some(role => member.roles.cache.has(role.id));
  }

  if (ticket.type === 'fondation') {
    return getFoundationRoles(member.guild).some(role => member.roles.cache.has(role.id));
  }

  // L'Ã‰quipe Staff peut prendre en charge et fermer ces catÃ©gories normales.
  if (STAFF_HANDLED_TICKET_TYPES.has(ticket.type)) {
    return hasRoleAtOrAbove(member, 'Ã‰quipe Staff');
  }

  return false;
}

async function refreshTicketMessage(channel, ticket) {
  if (!ticket.controlMessageId) return;
  try {
    const message = await channel.messages.fetch(ticket.controlMessageId);
    await message.edit({
      embeds: buildTicketEmbeds(ticket),
      components: controlRows(ticket),
      allowedMentions: { parse: ['users'] }
    });
  } catch (error) {
    if (error?.code !== 10008) {
      console.error('âŒ Actualisation ticket impossible :', error?.message || error);
    }
  }
}

async function restoreOpenTickets(guild) {
  const ticketsData = getTicketsData();
  let changed = false;
  let restored = 0;
  let missing = 0;

  for (const [channelId, ticket] of Object.entries(ticketsData.tickets)) {
    if (ticket.guildId !== guild.id || ticket.status !== 'open') continue;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      missing += 1;
      continue;
    }

    const owner = await client.users.fetch(ticket.ownerId).catch(() => null);
    const ownerUsername = owner?.username || ticket.ownerUsername || `utilisateur-${String(ticket.ownerId).slice(-4)}`;

    if (ticket.ownerUsername !== ownerUsername) {
      ticket.ownerUsername = ownerUsername;
      changed = true;
    }

    // Migration automatique des anciens noms numÃ©rotÃ©s vers le nom d'utilisateur.
    const desiredName = ticketChannelName(ticket.type, ownerUsername);
    if (channel.name !== desiredName) {
      await channel.setName(desiredName, 'Migration des tickets vers les noms utilisateurs').catch(error => {
        console.warn(`âš ï¸ Renommage impossible pour ${channelId} :`, error?.message || error);
      });
    }

    let controlMessage = null;
    if (ticket.controlMessageId) {
      controlMessage = await channel.messages.fetch(ticket.controlMessageId).catch(() => null);
    }

    // Une mise Ã  jour ne doit jamais casser les boutons d'un ticket dÃ©jÃ  ouvert.
    if (!controlMessage) {
      controlMessage = await channel.send({
        content: `<@${ticket.ownerId}>`,
        embeds: buildTicketEmbeds(ticket),
        components: controlRows(ticket),
        allowedMentions: { users: [ticket.ownerId] }
      }).catch(error => {
        console.error(`âŒ Restauration du ticket ${channelId} impossible :`, error?.message || error);
        return null;
      });

      if (controlMessage) {
        ticket.controlMessageId = controlMessage.id;
        changed = true;
      }
    } else {
      await controlMessage.edit({
        embeds: buildTicketEmbeds(ticket),
        components: controlRows(ticket),
        allowedMentions: { parse: ['users'] }
      }).catch(error => {
        console.error(`âŒ Actualisation du ticket ${channelId} impossible :`, error?.message || error);
      });
    }

    restored += 1;
  }

  if (changed) writeJson(TICKETS_FILE, ticketsData);

  console.log(
    `ðŸŽ« Tickets restaurÃ©s sur ${guild.name} : ${restored} actif(s), ${missing} salon(s) introuvable(s)`
  );
}

async function createTicketFromModal(interaction, typeKey, concernedUserId = null) {
  const type = TICKET_TYPES[typeKey];
  if (!type) {
    return interaction.reply({
      content: 'âŒ CatÃ©gorie invalide.',
      flags: MessageFlags.Ephemeral
    });
  }

  const config = getTicketConfig();
  if (!config.ticketCategoryId) {
    return interaction.reply({
      content: 'âŒ La catÃ©gorie des tickets nâ€™est pas configurÃ©e.',
      flags: MessageFlags.Ephemeral
    });
  }

  const ticketsData = getTicketsData();
  const duplicate = Object.entries(ticketsData.tickets).find(
    ([, ticket]) =>
      ticket.guildId === interaction.guild.id &&
      ticket.ownerId === interaction.user.id &&
      ticket.type === typeKey &&
      ticket.status === 'open'
  );

  if (duplicate) {
    return interaction.reply({
      content: `âŒ Vous avez dÃ©jÃ  un ticket de cette catÃ©gorie : <#${duplicate[0]}>`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (typeKey === 'partenariat') {
    const link = fieldValue(interaction, 'lien');
    if (!/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i.test(link)) {
      return interaction.reply({
        content: 'âŒ Le lien Discord fourni nâ€™est pas valide.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const reference = nextReference(typeKey);
  const formIds = {
    plainte_staff: ['motif', 'description', 'date', 'preuves'],
    question_rc: ['sujet', 'regle', 'question', 'contexte', 'complement'],
    question: ['sujet', 'question', 'contexte'],
    fondation: ['sujet', 'motif', 'message', 'priorite'],
    partenariat: ['serveur', 'lien', 'membres', 'description', 'proposition']
  }[typeKey];

  const formData = {};
  for (const id of formIds) formData[id] = fieldValue(interaction, id);

  let createdChannel = null;

  try {
    createdChannel = await interaction.guild.channels.create({
      name: ticketChannelName(typeKey, interaction.user.username),
      type: ChannelType.GuildText,
      parent: config.ticketCategoryId,
      topic: `${reference} | ${type.label} | CrÃ©ateur: ${interaction.user.id}`,
      permissionOverwrites: buildPermissionOverwrites(
        interaction.guild,
        interaction.user.id,
        typeKey,
        concernedUserId
      )
    });

    // Discord peut parfois renvoyer le salon avant qu'il soit totalement disponible.
    // On attend briÃ¨vement puis on le rÃ©cupÃ¨re Ã  nouveau depuis l'API.
    await new Promise(resolve => setTimeout(resolve, 800));

    // Le salon retournÃ© par guild.channels.create est dÃ©jÃ  utilisable.
    // On tente ensuite un fetch, mais on garde le salon crÃ©Ã© comme solution de secours.
    let channel = await interaction.guild.channels
      .fetch(createdChannel.id, { force: true })
      .catch(() => createdChannel);

    if (!channel || !channel.isTextBased()) {
      channel = createdChannel;
    }

    const ticket = {
      guildId: interaction.guild.id,
      channelId: channel.id,
      reference,
      type: typeKey,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      concernedUserId,
      formData,
      status: 'open',
      claimedBy: null,
      addedUserIds: [],
      createdAt: Date.now(),
      controlMessageId: null
    };

    let message = null;

    // Deux essais maximum pour Ã©viter l'erreur Discord 10003 (Unknown Channel).
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        message = await channel.send({
          content: `<@${interaction.user.id}>`,
          embeds: buildTicketEmbeds(ticket),
          components: controlRows(ticket),
          allowedMentions: { users: [interaction.user.id] }
        });
        break;
      } catch (error) {
        if (error?.code !== 10003 || attempt === 2) throw error;

        await new Promise(resolve => setTimeout(resolve, 1500));
        channel = await interaction.guild.channels
          .fetch(createdChannel.id, { force: true })
          .catch(() => createdChannel);

        if (!channel || !channel.isTextBased()) {
          channel = createdChannel;
        }
      }
    }

    if (!message) {
      throw new Error('Impossible dâ€™envoyer le message initial du ticket.');
    }

    ticket.controlMessageId = message.id;
    ticketsData.tickets[channel.id] = ticket;
    writeJson(TICKETS_FILE, ticketsData);

    await interaction.editReply({
      content: `âœ… Votre ticket **${interaction.user.username}** a Ã©tÃ© crÃ©Ã© : ${channel}`
    });

    await sendTicketLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(type.color)
        .setTitle(`${type.emoji} Dossier crÃ©Ã© â€” ${reference}`)
        .addFields(
          { name: 'CrÃ©ateur', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'CatÃ©gorie', value: type.label, inline: true },
          { name: 'Salon', value: `${channel}`, inline: true }
        )
        .setTimestamp()
    );
  } catch (error) {
    console.error('âŒ CrÃ©ation du ticket impossible :', error);

    // Nettoyage : si un salon vide a Ã©tÃ© crÃ©Ã©, on le supprime.
    if (createdChannel) {
      await createdChannel.delete('Ã‰chec de crÃ©ation du ticket').catch(() => {});
    }

    return interaction.editReply({
      content:
        'âŒ Le ticket nâ€™a pas pu Ãªtre crÃ©Ã© correctement.\n' +
        'VÃ©rifiez que le bot possÃ¨de **Voir les salons**, **GÃ©rer les salons**, ' +
        '**Envoyer des messages** et **GÃ©rer les permissions** dans la catÃ©gorie configurÃ©e.'
    });
  }
}

async function makeTranscript(channel, ticket) {
  const allMessages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;

    allMessages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `TRANSCRIPTION UNITY RP`,
    `RÃ©fÃ©rence : ${ticket.reference}`,
    `CatÃ©gorie : ${TICKET_TYPES[ticket.type].label}`,
    `CrÃ©ateur : ${ticket.ownerId}`,
    `Responsable : ${ticket.claimedBy || 'Aucun'}`,
    `CrÃ©Ã© le : ${new Date(ticket.createdAt).toLocaleString('fr-FR')}`,
    '',
    'MESSAGES',
    'â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”'
  ];

  for (const message of allMessages) {
    const date = new Date(message.createdTimestamp).toLocaleString('fr-FR');
    const content = message.content || '[Message sans texte]';
    lines.push(`[${date}] ${message.author.tag} (${message.author.id})`);
    lines.push(content);

    for (const attachment of message.attachments.values()) {
      lines.push(`PiÃ¨ce jointe : ${attachment.url}`);
    }

    lines.push('');
  }

  const buffer = Buffer.from(lines.join('\n'), 'utf8');
  return new AttachmentBuilder(buffer, {
    name: `transcription-${ticket.reference}.txt`
  });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  presence: {
    status: 'online',
    activities: [{ name: 'Unity RP', type: ActivityType.Playing }]
  }
});

function buildCommands() {
  const categoryChoices = HIERARCHY_CATEGORIES.map(category => ({
    name: category,
    value: category
  }));

  const config = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuration privÃ©e du bot Unity RP.')
    .addSubcommand(sub =>
      sub
        .setName('role')
        .setDescription('Ajoute ou dÃ©place un rÃ´le dans la hiÃ©rarchie.')
        .addRoleOption(option =>
          option.setName('role').setDescription('RÃ´le').setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('categorie')
            .setDescription('CatÃ©gorie')
            .setRequired(true)
            .addChoices(...categoryChoices)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('supprimer')
        .setDescription('Retire un rÃ´le de la hiÃ©rarchie.')
        .addRoleOption(option =>
          option.setName('role').setDescription('RÃ´le').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('voir').setDescription('Voir la hiÃ©rarchie configurÃ©e.')
    )
    .addSubcommand(sub =>
      sub.setName('vider').setDescription('Vider la hiÃ©rarchie.')
    )
    .addSubcommandGroup(group =>
      group
        .setName('acces')
        .setDescription('GÃ©rer les personnes autorisÃ©es aux commandes.')
        .addSubcommand(sub =>
          sub
            .setName('ajouter')
            .setDescription('Autoriser un membre.')
            .addUserOption(option =>
              option.setName('membre').setDescription('Membre').setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('retirer')
            .setDescription('Retirer lâ€™accÃ¨s Ã  un membre.')
            .addUserOption(option =>
              option.setName('membre').setDescription('Membre').setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub.setName('voir').setDescription('Voir les membres autorisÃ©s.')
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('ticket')
        .setDescription('Configurer le systÃ¨me de tickets.')
        .addSubcommand(sub =>
          sub
            .setName('salon')
            .setDescription('Choisir le salon du panneau.')
            .addChannelOption(option =>
              option
                .setName('salon')
                .setDescription('Salon du panneau')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('categorie')
            .setDescription('Choisir la catÃ©gorie de crÃ©ation.')
            .addChannelOption(option =>
              option
                .setName('categorie')
                .setDescription('CatÃ©gorie des tickets')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('logs')
            .setDescription('Choisir le salon des logs.')
            .addChannelOption(option =>
              option
                .setName('salon')
                .setDescription('Salon des logs')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub.setName('panneau').setDescription('Publier ou actualiser le panneau.')
        )
        .addSubcommand(sub =>
          sub.setName('voir').setDescription('Voir la configuration des tickets.')
        )
    );

  const hierarchy = new SlashCommandBuilder()
    .setName('hierarchie')
    .setDescription('Publie la hiÃ©rarchie du serveur.');

  return [config.toJSON(), hierarchy.toJSON()];
}

client.once(Events.ClientReady, async readyClient => {
  ensureData();

  console.log('âœ… UNITY RP BOT CONNECTÃ‰');
  console.log(`ðŸ’¾ Stockage persistant utilisÃ© : ${DATA_DIR}`);
  console.log(`ðŸ’¾ HiÃ©rarchie : ${HIERARCHY_FILE}`);
  console.log(`ðŸ’¾ Tickets : ${TICKETS_FILE}`);
  console.log(`ðŸ¤– ${readyClient.user.tag}`);
  console.log(`ðŸŒ Serveurs : ${readyClient.guilds.cache.size}`);
  console.log(`ðŸ” PropriÃ©taire : ${OWNER_USERNAME}`);

  try {
    await readyClient.application.commands.set([]);
  } catch (error) {
    console.warn('âš ï¸ Nettoyage global :', error?.message || error);
  }

  const commands = buildCommands();

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      await guild.commands.set(commands);
      await restoreOpenTickets(guild);
      console.log(`âœ… Commandes installÃ©es sur ${guild.name}`);
    } catch (error) {
      console.error(`âŒ Initialisation ${guild.name} :`, error);
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'config') {
        if (!isConfigAuthorized(interaction.user)) {
          return interaction.reply({
            content: 'âŒ Cette commande est privÃ©e.',
            flags: MessageFlags.Ephemeral
          });
        }

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        if (group === 'acces') {
          if (!isOwner(interaction.user)) {
            return interaction.reply({
              content: 'âŒ Seul ytmaxed peut gÃ©rer les accÃ¨s.',
              flags: MessageFlags.Ephemeral
            });
          }

          const access = getAccessData();

          if (sub === 'ajouter') {
            const member = interaction.options.getUser('membre', true);
            if (!isOwner(member) && !access.userIds.includes(member.id)) {
              access.userIds.push(member.id);
              writeJson(ACCESS_FILE, access);
            }

            return interaction.reply({
              content: `âœ… ${member} peut maintenant utiliser les commandes privÃ©es.`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'retirer') {
            const member = interaction.options.getUser('membre', true);
            access.userIds = access.userIds.filter(id => id !== member.id);
            writeJson(ACCESS_FILE, access);

            return interaction.reply({
              content: `âœ… AccÃ¨s retirÃ© Ã  ${member}.`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'voir') {
            const list = access.userIds.length
              ? access.userIds.map(id => `<@${id}>`).join('\n')
              : '> Aucun membre supplÃ©mentaire';

            return interaction.reply({
              content: `# ðŸ” ACCÃˆS PRIVÃ‰S\n\n**PropriÃ©taire :** ${OWNER_USERNAME}\n\n${list}`,
              allowedMentions: { parse: [] },
              flags: MessageFlags.Ephemeral
            });
          }
        }

        if (group === 'ticket') {
          const config = getTicketConfig();

          if (sub === 'salon') {
            const channel = interaction.options.getChannel('salon', true);
            writeJson(TICKET_CONFIG_FILE, {
              ...config,
              panelChannelId: channel.id,
              panelMessageId: null
            });

            return interaction.reply({
              content: `âœ… Salon du panneau : ${channel}`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'categorie') {
            const category = interaction.options.getChannel('categorie', true);
            writeJson(TICKET_CONFIG_FILE, {
              ...config,
              ticketCategoryId: category.id
            });

            return interaction.reply({
              content: `âœ… CatÃ©gorie des tickets : **${category.name}**`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'logs') {
            const channel = interaction.options.getChannel('salon', true);
            writeJson(TICKET_CONFIG_FILE, {
              ...config,
              logsChannelId: channel.id
            });

            return interaction.reply({
              content: `âœ… Salon des logs : ${channel}`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'panneau') {
            if (!config.panelChannelId) {
              return interaction.reply({
                content: 'âŒ Configure dâ€™abord le salon du panneau.',
                flags: MessageFlags.Ephemeral
              });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const channel = await interaction.guild.channels.fetch(config.panelChannelId);

            let message = null;
            if (config.panelMessageId) {
              try {
                message = await channel.messages.fetch(config.panelMessageId);
                await message.edit(buildPanelPayload());
              } catch {
                message = null;
              }
            }

            if (!message) {
              message = await channel.send(buildPanelPayload());
              writeJson(TICKET_CONFIG_FILE, {
                ...config,
                panelMessageId: message.id
              });
            }

            return interaction.editReply({
              content: `âœ… Panneau publiÃ© : ${message.url}`
            });
          }

          if (sub === 'voir') {
            return interaction.reply({
              content:
                '# ðŸŽ« CONFIGURATION DES TICKETS\n\n' +
                `**Panneau :** ${config.panelChannelId ? `<#${config.panelChannelId}>` : 'Non configurÃ©'}\n` +
                `**CatÃ©gorie :** ${config.ticketCategoryId ? `<#${config.ticketCategoryId}>` : 'Non configurÃ©e'}\n` +
                `**Logs :** ${config.logsChannelId ? `<#${config.logsChannelId}>` : 'Non configurÃ©'}\n\n` +
                '**Tickets normaux :** Ã‰quipe Staff et rÃ´les supÃ©rieurs\n' +
                '**Plainte Staff :** GÃ©rance/Fondation, personne concernÃ©e exclue\n' +
                '**Fondation :** Fondation uniquement',
              allowedMentions: { parse: [] },
              flags: MessageFlags.Ephemeral
            });
          }
        }

        const hierarchy = getHierarchy();

        if (sub === 'role') {
          const role = interaction.options.getRole('role', true);
          const category = interaction.options.getString('categorie', true);

          for (const cat of HIERARCHY_CATEGORIES) {
            hierarchy[cat] = hierarchy[cat].filter(id => id !== role.id);
          }

          hierarchy[category].push(role.id);
          writeJson(HIERARCHY_FILE, hierarchy);
          await updateSavedHierarchyMessage(interaction.guild);

          return interaction.reply({
            content: `âœ… ${role} ajoutÃ© dans **${category}**.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (sub === 'supprimer') {
          const role = interaction.options.getRole('role', true);

          for (const cat of HIERARCHY_CATEGORIES) {
            hierarchy[cat] = hierarchy[cat].filter(id => id !== role.id);
          }

          writeJson(HIERARCHY_FILE, hierarchy);
          await updateSavedHierarchyMessage(interaction.guild);

          return interaction.reply({
            content: `âœ… ${role} retirÃ© de la hiÃ©rarchie.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (sub === 'voir') {
          let content = '# âš™ï¸ HIÃ‰RARCHIE CONFIGURÃ‰E\n\n';
          for (const category of HIERARCHY_CATEGORIES) {
            content += `## ${category}\n`;
            content += hierarchy[category].length
              ? `${hierarchy[category].map(id => `<@&${id}>`).join('\n')}\n\n`
              : '> Aucun rÃ´le\n\n';
          }

          return interaction.reply({
            content: content.slice(0, 1900),
            allowedMentions: { parse: [] },
            flags: MessageFlags.Ephemeral
          });
        }

        if (sub === 'vider') {
          writeJson(
            HIERARCHY_FILE,
            Object.fromEntries(HIERARCHY_CATEGORIES.map(c => [c, []]))
          );
          await updateSavedHierarchyMessage(interaction.guild);

          return interaction.reply({
            content: 'âœ… HiÃ©rarchie vidÃ©e.',
            flags: MessageFlags.Ephemeral
          });
        }
      }

      if (interaction.commandName === 'hierarchie') {
        if (!isConfigAuthorized(interaction.user)) {
          return interaction.reply({
            content: 'âŒ Vous nâ€™Ãªtes pas autorisÃ©.',
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.deferReply();
        const message = await interaction.editReply(
          await buildHierarchyPayload(interaction.guild)
        );

        writeJson(HIERARCHY_MESSAGE_FILE, {
          guildId: interaction.guild.id,
          channelId: message.channelId,
          messageId: message.id
        });

        return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:type') {
      const typeKey = interaction.values[0];

      if (typeKey === 'plainte_staff') {
        const selector = new UserSelectMenuBuilder()
          .setCustomId('ticket:complaint_user')
          .setPlaceholder('SÃ©lectionnez le membre du staff concernÃ©')
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.reply({
          content: 'ðŸ” SÃ©lectionnez la personne concernÃ©e. Elle sera totalement exclue du ticket.',
          components: [new ActionRowBuilder().addComponents(selector)],
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.showModal(buildTicketModal(typeKey));
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'ticket:complaint_user') {
      const concernedUserId = interaction.values[0];

      if (concernedUserId === interaction.user.id) {
        return interaction.update({
          content: 'âŒ Vous ne pouvez pas vous sÃ©lectionner vous-mÃªme.',
          components: []
        });
      }

      return interaction.showModal(buildTicketModal('plainte_staff', concernedUserId));
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:modal:')) {
      const parts = interaction.customId.split(':');
      const typeKey = parts[2];
      const concernedUserId = parts[3] || null;
      return createTicketFromModal(interaction, typeKey, concernedUserId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
      const ticketsData = getTicketsData();
      const ticket = ticketsData.tickets[interaction.channelId];

      if (!ticket || ticket.status !== 'open') {
        return interaction.reply({
          content: 'âŒ Ce dossier est introuvable ou fermÃ©.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:claim') {
        if (!canHandleTicket(interaction.member, ticket)) {
          return interaction.reply({
            content: 'âŒ Vous ne pouvez pas prendre en charge ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        if (ticket.claimedBy) {
          return interaction.reply({
            content: `âŒ DÃ©jÃ  pris en charge par <@${ticket.claimedBy}>.`,
            flags: MessageFlags.Ephemeral
          });
        }

        ticket.claimedBy = interaction.user.id;
        writeJson(TICKETS_FILE, ticketsData);
        await refreshTicketMessage(interaction.channel, ticket);

        await interaction.reply({
          content: `âœ… Dossier pris en charge par ${interaction.user}.`,
          allowedMentions: { users: [interaction.user.id] }
        });

        return sendTicketLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`ðŸ“— Dossier pris en charge â€” ${ticket.reference}`)
            .setDescription(`Responsable : <@${interaction.user.id}>`)
            .setTimestamp()
        );
      }

      if (interaction.customId === 'ticket:release') {
        const allowed =
          ticket.claimedBy === interaction.user.id ||
          isTicketManager(interaction.member);

        if (!allowed) {
          return interaction.reply({
            content: 'âŒ Seul le responsable, la GÃ©rance ou une personne autorisÃ©e peut libÃ©rer ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        ticket.claimedBy = null;
        writeJson(TICKETS_FILE, ticketsData);
        await refreshTicketMessage(interaction.channel, ticket);

        return interaction.reply({
          content: `ðŸ“˜ Dossier libÃ©rÃ© par ${interaction.user}.`,
          allowedMentions: { users: [interaction.user.id] }
        });
      }

      if (interaction.customId === 'ticket:add_member') {
        if (!canHandleTicket(interaction.member, ticket)) {
          return interaction.reply({
            content: 'âŒ Vous ne pouvez pas ajouter de membre.',
            flags: MessageFlags.Ephemeral
          });
        }

        const selector = new UserSelectMenuBuilder()
          .setCustomId('ticket:add_member_select')
          .setPlaceholder('SÃ©lectionnez un membre Ã  ajouter')
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.reply({
          content: 'SÃ©lectionnez le membre Ã  ajouter.',
          components: [new ActionRowBuilder().addComponents(selector)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:remove_member') {
        if (!canHandleTicket(interaction.member, ticket)) {
          return interaction.reply({
            content: 'âŒ Vous ne pouvez pas retirer de membre.',
            flags: MessageFlags.Ephemeral
          });
        }

        const selector = new UserSelectMenuBuilder()
          .setCustomId('ticket:remove_member_select')
          .setPlaceholder('SÃ©lectionnez un membre Ã  retirer')
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.reply({
          content: 'SÃ©lectionnez le membre Ã  retirer.',
          components: [new ActionRowBuilder().addComponents(selector)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:transcript') {
        if (!canHandleTicket(interaction.member, ticket) && interaction.user.id !== ticket.ownerId) {
          return interaction.reply({
            content: 'âŒ Vous ne pouvez pas gÃ©nÃ©rer la transcription.',
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const file = await makeTranscript(interaction.channel, ticket);

        await interaction.editReply({
          content: `âœ… Transcription de **${ticket.reference}** :`,
          files: [file]
        });

        return;
      }

      if (interaction.customId === 'ticket:close') {
        const allowed =
          interaction.user.id === ticket.ownerId ||
          canHandleTicket(interaction.member, ticket);

        if (!allowed) {
          return interaction.reply({
            content: 'âŒ Vous ne pouvez pas fermer ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        const confirm = new ButtonBuilder()
          .setCustomId('ticket:close_confirm')
          .setLabel('Confirmer la fermeture')
          .setEmoji('âœ…')
          .setStyle(ButtonStyle.Danger);

        const cancel = new ButtonBuilder()
          .setCustomId('ticket:close_cancel')
          .setLabel('Annuler')
          .setEmoji('âŒ')
          .setStyle(ButtonStyle.Secondary);

        return interaction.reply({
          content:
            'âš ï¸ **Confirmation**\nUne transcription sera crÃ©Ã©e avant la suppression du salon.',
          components: [new ActionRowBuilder().addComponents(confirm, cancel)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:close_cancel') {
        return interaction.update({
          content: 'âœ… Fermeture annulÃ©e.',
          components: []
        });
      }

      if (interaction.customId === 'ticket:close_confirm') {
        const allowed =
          interaction.user.id === ticket.ownerId ||
          canHandleTicket(interaction.member, ticket);

        if (!allowed) {
          return interaction.reply({
            content: 'âŒ Vous ne pouvez pas fermer ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.update({
          content: 'ðŸ”’ Fermeture en coursâ€¦',
          components: []
        });

        const transcript = await makeTranscript(interaction.channel, ticket);
        ticket.status = 'closed';
        ticket.closedBy = interaction.user.id;
        ticket.closedAt = Date.now();
        writeJson(TICKETS_FILE, ticketsData);

        await sendTicketLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(`ðŸ”’ Dossier fermÃ© â€” ${ticket.reference}`)
            .addFields(
              { name: 'CrÃ©ateur', value: `<@${ticket.ownerId}>`, inline: true },
              { name: 'Responsable', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Aucun', inline: true },
              { name: 'FermÃ© par', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp(),
          [transcript]
        );

        try {
          const owner = await client.users.fetch(ticket.ownerId);
          if (ticket.type !== 'plainte_staff' || owner.id !== ticket.concernedUserId) {
            await owner.send({
              content: `ðŸ“ Transcription de votre dossier **${ticket.reference}**.`,
              files: [await makeTranscript(interaction.channel, ticket)]
            });
          }
        } catch {
          // Les MP peuvent Ãªtre fermÃ©s.
        }

        setTimeout(async () => {
          try {
            await interaction.channel.delete(`Dossier ${ticket.reference} fermÃ©`);
          } catch (error) {
            console.error('âŒ Suppression du ticket impossible :', error?.message || error);
          }
        }, 10000);

        return;
      }
    }

    if (
      interaction.isUserSelectMenu() &&
      ['ticket:add_member_select', 'ticket:remove_member_select'].includes(interaction.customId)
    ) {
      const ticketsData = getTicketsData();
      const ticket = ticketsData.tickets[interaction.channelId];

      if (!ticket || ticket.status !== 'open') {
        return interaction.update({
          content: 'âŒ Ce dossier est introuvable.',
          components: []
        });
      }

      if (!canHandleTicket(interaction.member, ticket)) {
        return interaction.update({
          content: 'âŒ Vous ne pouvez pas modifier les accÃ¨s.',
          components: []
        });
      }

      const userId = interaction.values[0];

      if (interaction.customId === 'ticket:add_member_select') {
        if (ticket.concernedUserId === userId) {
          return interaction.update({
            content: 'âŒ La personne concernÃ©e par la plainte ne peut jamais Ãªtre ajoutÃ©e.',
            components: []
          });
        }

        await interaction.channel.permissionOverwrites.edit(userId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });

        if (!ticket.addedUserIds.includes(userId)) ticket.addedUserIds.push(userId);
        writeJson(TICKETS_FILE, ticketsData);

        return interaction.update({
          content: `âœ… <@${userId}> a Ã©tÃ© ajoutÃ© au dossier.`,
          components: [],
          allowedMentions: { users: [userId] }
        });
      }

      if (userId === ticket.ownerId) {
        return interaction.update({
          content: 'âŒ Le crÃ©ateur du dossier ne peut pas Ãªtre retirÃ©.',
          components: []
        });
      }

      await interaction.channel.permissionOverwrites.delete(userId).catch(() => {});
      ticket.addedUserIds = ticket.addedUserIds.filter(id => id !== userId);
      writeJson(TICKETS_FILE, ticketsData);

      return interaction.update({
        content: `âœ… <@${userId}> a Ã©tÃ© retirÃ© du dossier.`,
        components: [],
        allowedMentions: { users: [userId] }
      });
    }
  } catch (error) {
    console.error('âŒ Interaction impossible :', error);

    const payload = {
      content: 'âŒ Une erreur est survenue.',
      flags: MessageFlags.Ephemeral
    };

    if (interaction.deferred || interaction.replied) {
      return interaction.followUp(payload).catch(() => {});
    }

    return interaction.reply(payload).catch(() => {});
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const hierarchy = getHierarchy();
  const configuredRoleIds = new Set(Object.values(hierarchy).flat());

  const changed =
    [...oldMember.roles.cache.keys()].some(
      id => configuredRoleIds.has(id) && !newMember.roles.cache.has(id)
    ) ||
    [...newMember.roles.cache.keys()].some(
      id => configuredRoleIds.has(id) && !oldMember.roles.cache.has(id)
    );

  if (changed) scheduleHierarchyUpdate(newMember.guild);
});

client.on(Events.ChannelDelete, channel => {
  const data = getTicketsData();
  if (data.tickets[channel.id]) {
    delete data.tickets[channel.id];
    writeJson(TICKETS_FILE, data);
  }
});

client.on(Events.Error, error => {
  if (error?.code === 10003) {
    console.warn('âš ï¸ Discord a signalÃ© un salon introuvable (10003). Le ticket sera nettoyÃ© automatiquement.');
    return;
  }

  console.error('âŒ Discord :', error);
});
process.on('unhandledRejection', error => console.error('âŒ Promesse non gÃ©rÃ©e :', error));
process.on('uncaughtException', error => console.error('âŒ Erreur non interceptÃ©e :', error));

let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`ðŸ›‘ ${signal} reÃ§u : arrÃªt propre.`);
  client.destroy();
  setTimeout(() => process.exit(0), 250);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

client.login(process.env.TOKEN);
