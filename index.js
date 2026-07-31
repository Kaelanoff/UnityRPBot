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

require('dotenv').config({ quiet: true });

if (!process.env.TOKEN) {
  console.error(' TOKEN manquant dans .env / Railway Variables.');
  process.exit(1);
}

const OWNER_USERNAME = 'ytmaxed';

// Stockage persistant Railway.
// Ton volume doit etre monte exactement sur /data.
// Tu peux aussi definir DATA_DIR dans Railway si tu changes le chemin plus tard.
const DATA_DIR = process.env.DATA_DIR || '/data';
const HIERARCHY_FILE = path.join(DATA_DIR, 'hierarchie.json');
const HIERARCHY_MESSAGE_FILE = path.join(DATA_DIR, 'hierarchie-message.json');
const ACCESS_FILE = path.join(DATA_DIR, 'access.json');
const TICKET_CONFIG_FILE = path.join(DATA_DIR, 'ticket-config.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');

const HIERARCHY_CATEGORIES = [
  'FONDATION',
  'MEMBRES DE LA GERANCE',
  'ADMINISTRATION',
  'MODERATION',
  'AIDE',
  'GERANCES SPECIALISEES',
  'BUILD',
  'BOT',
  'AUTRES ROLES'
];

const STAFF_HANDLED_TICKET_TYPES = new Set([
  'question_rc',
  'question',
  'partenariat'
]);

const TICKET_TYPES = {
  plainte_staff: {
    prefix: 'PL',
    emoji: '',
    label: 'Plainte Staff',
    description: 'Signaler confidentiellement un membre du staff.',
    color: 0xED4245
  },
  question_rc: {
    prefix: 'RC',
    emoji: '',
    label: 'Question RC Staff',
    description: 'Question sur le reglement ou les procedures staff.',
    color: 0x5865F2
  },
  question: {
    prefix: 'QST',
    emoji: '',
    label: 'Question generale',
    description: 'Poser une question concernant Unity RP.',
    color: 0x57F287
  },
  fondation: {
    prefix: 'FND',
    emoji: '',
    label: 'Contacter la Fondation',
    description: 'Envoyer une demande directement a la Fondation.',
    color: 0xFEE75C
  },
  partenariat: {
    prefix: 'PART',
    emoji: '',
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

    // Verifie que le volume est reellement accessible en ecriture.
    const testFile = path.join(DATA_DIR, '.write-test');
    fs.writeFileSync(testFile, String(Date.now()), 'utf8');
    fs.unlinkSync(testFile);
  } catch (error) {
    console.error(` Impossible decrire dans le stockage persistant ${DATA_DIR}.`);
    console.error(' Verifie que le volume Railway est monte sur /data.');
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

  // Cherche d'abord le nom exact, puis accepte les decorations/emojis autour du nom.
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
      hasRoleAtOrAbove(member, 'Gerant Staff')
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


function hierarchyCategoryLabel(category) {
  const labels = {
    'FONDATION': 'FONDATION',
    'MEMBRES DE LA GERANCE': 'MEMBRES DE LA GERANCE',
    'ADMINISTRATION': 'ADMINISTRATION',
    'MODERATION': 'MODERATION',
    'AIDE': 'AIDE',
    'GERANCES SPECIALISEES': 'GERANCES SPECIALISEES',
    'BUILD': 'BUILD',
    'BOT': 'BOT',
    'AUTRES ROLES': 'AUTRES ROLES'
  };
  return labels[category] || category;
}

async function buildHierarchyPayload(guild) {
  await guild.roles.fetch().catch(() => null);

  const hierarchy = getHierarchy();
  let changed = false;
  const embeds = [];

  for (const category of HIERARCHY_CATEGORIES) {
    const savedIds = Array.isArray(hierarchy[category]) ? hierarchy[category] : [];
    const roles = savedIds
      .map(id => guild.roles.cache.get(id))
      .filter(Boolean)
      .sort((a, b) => b.position - a.position);

    const validIds = roles.map(role => role.id);
    if (validIds.length !== savedIds.length || validIds.some((id, i) => id !== savedIds[i])) {
      hierarchy[category] = validIds;
      changed = true;
    }

    const description = roles.length
      ? roles.map(role => `<@&${role.id}>`).join('\n')
      : '> Aucun role configure';

    embeds.push(
      new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(hierarchyCategoryLabel(category))
        .setDescription(description.slice(0, 4096))
    );
  }

  if (changed) writeJson(HIERARCHY_FILE, hierarchy);

  return {
    content: '# HIERARCHIE OFFICIELLE - UNITY RP',
    embeds: embeds.slice(0, 10),
    allowedMentions: { parse: [] }
  };
}

async function updateSavedHierarchyMessage(guild) {
  const saved = readJson(HIERARCHY_MESSAGE_FILE, {
    guildId: null,
    channelId: null,
    messageId: null
  });

  if (!saved.guildId || !saved.channelId || !saved.messageId) return false;
  if (saved.guildId !== guild.id) return false;

  try {
    const channel = await guild.channels.fetch(saved.channelId);
    if (!channel || !channel.isTextBased()) return false;

    const message = await channel.messages.fetch(saved.messageId);
    await message.edit(await buildHierarchyPayload(guild));
    return true;
  } catch (error) {
    console.warn('Mise a jour du message de hierarchie impossible :', error?.message || error);
    return false;
  }
}

function buildPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle(' CENTRE DASSISTANCE - UNITY RP')
    .setDescription(
      'Bienvenue dans le centre dassistance officiel de **Unity RP**.\n\n' +
      'Selectionnez ci-dessous la categorie correspondant a votre demande. ' +
      'Un formulaire adapte souvrira automatiquement.'
    )
    .addFields(
      Object.values(TICKET_TYPES).map(type => ({
        name: `${type.emoji} ${type.label}`,
        value: type.description,
        inline: false
      }))
    )
    .setFooter({ text: 'Unity RP - Un seul ticket par categorie et par membre' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:type')
    .setPlaceholder('Choisissez une categorie')
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value, type]) => ({
        label: type.label,
        description: type.description.slice(0, 100),
        value,}))
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
      modalField('description', 'Description complete des faits', TextInputStyle.Paragraph, true, 1800),
      modalField('date', 'Date et heure approximatives', TextInputStyle.Short, true, 100),
      modalField('preuves', 'Preuves disponibles', TextInputStyle.Paragraph, false, 1000, 'Liens, captures, videos, temoins...')
    );
  }

  if (typeKey === 'question_rc') {
    modal.addComponents(
      modalField('sujet', 'Sujet de la question', TextInputStyle.Short, true, 150),
      modalField('regle', 'Regle ou procedure concernee', TextInputStyle.Short, true, 200),
      modalField('question', 'Question complete', TextInputStyle.Paragraph, true, 1800),
      modalField('contexte', 'Contexte de la situation', TextInputStyle.Paragraph, true, 1200),
      modalField('complement', 'Informations supplementaires', TextInputStyle.Paragraph, false, 700)
    );
  }

  if (typeKey === 'question') {
    modal.addComponents(
      modalField('sujet', 'Sujet', TextInputStyle.Short, true, 150),
      modalField('question', 'Question complete', TextInputStyle.Paragraph, true, 1800),
      modalField('contexte', 'Contexte supplementaire', TextInputStyle.Paragraph, false, 1000)
    );
  }

  if (typeKey === 'fondation') {
    modal.addComponents(
      modalField('sujet', 'Sujet', TextInputStyle.Short, true, 150),
      modalField('motif', 'Motif du contact', TextInputStyle.Short, true, 200),
      modalField('message', 'Message complet', TextInputStyle.Paragraph, true, 1800),
      modalField('priorite', 'Priorite : Normal, Important ou Urgent', TextInputStyle.Short, true, 30)
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
    .setLabel(ticket.claimedBy ? 'Deja pris en charge' : 'Prendre en charge')
    .setStyle(ticket.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(Boolean(ticket.claimedBy));

  const release = new ButtonBuilder()
    .setCustomId('ticket:release')
    .setLabel('Liberer')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!ticket.claimedBy);

  const add = new ButtonBuilder()
    .setCustomId('ticket:add_member')
    .setLabel('Ajouter un membre')
    .setStyle(ButtonStyle.Secondary);

  const remove = new ButtonBuilder()
    .setCustomId('ticket:remove_member')
    .setLabel('Retirer un membre')
    .setStyle(ButtonStyle.Secondary);

  const transcript = new ButtonBuilder()
    .setCustomId('ticket:transcript')
    .setLabel('Transcription')
    .setStyle(ButtonStyle.Secondary);

  const close = new ButtonBuilder()
    .setCustomId('ticket:close')
    .setLabel('Fermer')
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
    regle: 'Regle ou procedure',
    question: 'Question',
    contexte: 'Contexte',
    complement: 'Informations supplementaires',
    message: 'Message',
    priorite: 'Priorite',
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
    .setTitle(`${type.emoji} ${type.label.toUpperCase()} - ${ticketOwnerName(ticket)}`)
    .setDescription(
      `**Createur :** <@${ticket.ownerId}>\n` +
      `**Statut :** ${ticket.claimedBy ? 'En cours de traitement' : 'En attente'}\n` +
      `**Responsable :** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Aucun'}`
    )
    .setTimestamp(ticket.createdAt)
    .addFields({
      name: 'Reference interne',
      value: ticket.reference,
      inline: true
    });

  if (ticket.concernedUserId) {
    info.addFields({
      name: 'Personne concernee',
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
      name: ' Confidentialite',
      value:
        'Visible uniquement par le createur, la Gerance autorisee et la Fondation. ' +
        'La personne concernee est explicitement exclue.',
      inline: false
    });
  }

  const controls = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle(' CENTRE DE CONTROLE')
    .setDescription(
      ' **Prendre en charge** - reserver le dossier\n' +
      ' **Liberer** - rendre le dossier disponible\n' +
      ' **Ajouter un membre** - donner un acces temporaire\n' +
      ' **Retirer un membre** - retirer un acces temporaire\n' +
      ' **Transcription** - generer lhistorique\n' +
      ' **Fermer** - cloturer le dossier'
    )
    .setFooter({ text: 'Unity RP - Les actions sont enregistrees' });

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
    console.error(' Log ticket impossible :', error?.message || error);
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

  // Tres important : le bot doit garder un acces individuel au salon.
  // Sinon le refus de @everyone peut aussi lui masquer le ticket juste apres sa creation.
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
      ...getRolesAtOrAbove(guild, 'Gerant Staff'),
      ...getFoundationRoles(guild)
    ];
  } else if (typeKey === 'fondation') {
    allowedRoles = getFoundationRoles(guild);
  } else {
    allowedRoles = getRolesAtOrAbove(guild, 'Equipe Staff');
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
    return hasRoleAtOrAbove(member, 'Gerant Staff') ||
      getFoundationRoles(member.guild).some(role => member.roles.cache.has(role.id));
  }

  if (ticket.type === 'fondation') {
    return getFoundationRoles(member.guild).some(role => member.roles.cache.has(role.id));
  }

  // L'Equipe Staff peut prendre en charge et fermer ces categories normales.
  if (STAFF_HANDLED_TICKET_TYPES.has(ticket.type)) {
    return hasRoleAtOrAbove(member, 'Equipe Staff');
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
      console.error(' Actualisation ticket impossible :', error?.message || error);
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

    // Migration automatique des anciens noms numerotes vers le nom d'utilisateur.
    const desiredName = ticketChannelName(ticket.type, ownerUsername);
    if (channel.name !== desiredName) {
      await channel.setName(desiredName, 'Migration des tickets vers les noms utilisateurs').catch(error => {
        console.warn(` Renommage impossible pour ${channelId} :`, error?.message || error);
      });
    }

    let controlMessage = null;
    if (ticket.controlMessageId) {
      controlMessage = await channel.messages.fetch(ticket.controlMessageId).catch(() => null);
    }

    // Une mise a jour ne doit jamais casser les boutons d'un ticket deja ouvert.
    if (!controlMessage) {
      controlMessage = await channel.send({
        content: `<@${ticket.ownerId}>`,
        embeds: buildTicketEmbeds(ticket),
        components: controlRows(ticket),
        allowedMentions: { users: [ticket.ownerId] }
      }).catch(error => {
        console.error(` Restauration du ticket ${channelId} impossible :`, error?.message || error);
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
        console.error(` Actualisation du ticket ${channelId} impossible :`, error?.message || error);
      });
    }

    restored += 1;
  }

  if (changed) writeJson(TICKETS_FILE, ticketsData);

  console.log(
    ` Tickets restaures sur ${guild.name} : ${restored} actif(s), ${missing} salon(s) introuvable(s)`
  );
}

async function createTicketFromModal(interaction, typeKey, concernedUserId = null) {
  const type = TICKET_TYPES[typeKey];
  if (!type) {
    return interaction.reply({
      content: ' Categorie invalide.',
      flags: MessageFlags.Ephemeral
    });
  }

  const config = getTicketConfig();
  if (!config.ticketCategoryId) {
    return interaction.reply({
      content: ' La categorie des tickets nest pas configuree.',
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
      content: ` Vous avez deja un ticket de cette categorie : <#${duplicate[0]}>`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (typeKey === 'partenariat') {
    const link = fieldValue(interaction, 'lien');
    if (!/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i.test(link)) {
      return interaction.reply({
        content: ' Le lien Discord fourni nest pas valide.',
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
      topic: `${reference} | ${type.label} | Createur: ${interaction.user.id}`,
      permissionOverwrites: buildPermissionOverwrites(
        interaction.guild,
        interaction.user.id,
        typeKey,
        concernedUserId
      )
    });

    // Discord peut parfois renvoyer le salon avant qu'il soit totalement disponible.
    // On attend brievement puis on le recupere a nouveau depuis l'API.
    await new Promise(resolve => setTimeout(resolve, 800));

    // Le salon retourne par guild.channels.create est deja utilisable.
    // On tente ensuite un fetch, mais on garde le salon cree comme solution de secours.
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

    // Deux essais maximum pour eviter l'erreur Discord 10003 (Unknown Channel).
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
      throw new Error('Impossible denvoyer le message initial du ticket.');
    }

    ticket.controlMessageId = message.id;
    ticketsData.tickets[channel.id] = ticket;
    writeJson(TICKETS_FILE, ticketsData);

    await interaction.editReply({
      content: ` Votre ticket **${interaction.user.username}** a ete cree : ${channel}`
    });

    await sendTicketLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(type.color)
        .setTitle(`${type.emoji} Dossier cree - ${reference}`)
        .addFields(
          { name: 'Createur', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Categorie', value: type.label, inline: true },
          { name: 'Salon', value: `${channel}`, inline: true }
        )
        .setTimestamp()
    );
  } catch (error) {
    console.error(' Creation du ticket impossible :', error);

    // Nettoyage : si un salon vide a ete cree, on le supprime.
    if (createdChannel) {
      await createdChannel.delete('Echec de creation du ticket').catch(() => {});
    }

    return interaction.editReply({
      content:
        ' Le ticket na pas pu etre cree correctement.\n' +
        'Verifiez que le bot possede **Voir les salons**, **Gerer les salons**, ' +
        '**Envoyer des messages** et **Gerer les permissions** dans la categorie configuree.'
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
    `Reference : ${ticket.reference}`,
    `Categorie : ${TICKET_TYPES[ticket.type].label}`,
    `Createur : ${ticket.ownerId}`,
    `Responsable : ${ticket.claimedBy || 'Aucun'}`,
    `Cree le : ${new Date(ticket.createdAt).toLocaleString('fr-FR')}`,
    '',
    'MESSAGES',
    ''
  ];

  for (const message of allMessages) {
    const date = new Date(message.createdTimestamp).toLocaleString('fr-FR');
    const content = message.content || '[Message sans texte]';
    lines.push(`[${date}] ${message.author.tag} (${message.author.id})`);
    lines.push(content);

    for (const attachment of message.attachments.values()) {
      lines.push(`Piece jointe : ${attachment.url}`);
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
    .setDescription('Configuration privee du bot Unity RP.')
    .addSubcommand(sub =>
      sub
        .setName('role')
        .setDescription('Ajoute ou deplace un role dans la hierarchie.')
        .addRoleOption(option =>
          option.setName('role').setDescription('Role').setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('categorie')
            .setDescription('Categorie')
            .setRequired(true)
            .addChoices(...categoryChoices)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('supprimer')
        .setDescription('Retire un role de la hierarchie.')
        .addRoleOption(option =>
          option.setName('role').setDescription('Role').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('voir').setDescription('Voir la hierarchie configuree.')
    )
    .addSubcommand(sub =>
      sub.setName('vider').setDescription('Vider la hierarchie.')
    )
    .addSubcommandGroup(group =>
      group
        .setName('acces')
        .setDescription('Gerer les personnes autorisees aux commandes.')
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
            .setDescription('Retirer lacces a un membre.')
            .addUserOption(option =>
              option.setName('membre').setDescription('Membre').setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub.setName('voir').setDescription('Voir les membres autorises.')
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('ticket')
        .setDescription('Configurer le systeme de tickets.')
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
            .setDescription('Choisir la categorie de creation.')
            .addChannelOption(option =>
              option
                .setName('categorie')
                .setDescription('Categorie des tickets')
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
    .setDescription('Publie la hierarchie du serveur.');

  return [config.toJSON(), hierarchy.toJSON()];
}

client.once(Events.ClientReady, async readyClient => {
  ensureData();

  console.log(' UNITY RP BOT CONNECTE');
  console.log(` Stockage persistant utilise : ${DATA_DIR}`);
  console.log(` Hierarchie : ${HIERARCHY_FILE}`);
  console.log(` Tickets : ${TICKETS_FILE}`);
  console.log(` ${readyClient.user.tag}`);
  console.log(` Serveurs : ${readyClient.guilds.cache.size}`);
  console.log(` Proprietaire : ${OWNER_USERNAME}`);

  try {
    await readyClient.application.commands.set([]);
  } catch (error) {
    console.warn(' Nettoyage global :', error?.message || error);
  }

  const commands = buildCommands();

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      await guild.commands.set(commands);
      await restoreOpenTickets(guild);
      console.log(` Commandes installees sur ${guild.name}`);
    } catch (error) {
      console.error(` Initialisation ${guild.name} :`, error);
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'config') {
        if (!isConfigAuthorized(interaction.user)) {
          return interaction.reply({
            content: ' Cette commande est privee.',
            flags: MessageFlags.Ephemeral
          });
        }

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        if (group === 'acces') {
          if (!isOwner(interaction.user)) {
            return interaction.reply({
              content: ' Seul ytmaxed peut gerer les acces.',
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
              content: ` ${member} peut maintenant utiliser les commandes privees.`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'retirer') {
            const member = interaction.options.getUser('membre', true);
            access.userIds = access.userIds.filter(id => id !== member.id);
            writeJson(ACCESS_FILE, access);

            return interaction.reply({
              content: ` Acces retire a ${member}.`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'voir') {
            const list = access.userIds.length
              ? access.userIds.map(id => `<@${id}>`).join('\n')
              : '> Aucun membre supplementaire';

            return interaction.reply({
              content: `#  ACCES PRIVES\n\n**Proprietaire :** ${OWNER_USERNAME}\n\n${list}`,
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
              content: ` Salon du panneau : ${channel}`,
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
              content: ` Categorie des tickets : **${category.name}**`,
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
              content: ` Salon des logs : ${channel}`,
              flags: MessageFlags.Ephemeral
            });
          }

          if (sub === 'panneau') {
            if (!config.panelChannelId) {
              return interaction.reply({
                content: ' Configure dabord le salon du panneau.',
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
              content: ` Panneau publie : ${message.url}`
            });
          }

          if (sub === 'voir') {
            return interaction.reply({
              content:
                '#  CONFIGURATION DES TICKETS\n\n' +
                `**Panneau :** ${config.panelChannelId ? `<#${config.panelChannelId}>` : 'Non configure'}\n` +
                `**Categorie :** ${config.ticketCategoryId ? `<#${config.ticketCategoryId}>` : 'Non configuree'}\n` +
                `**Logs :** ${config.logsChannelId ? `<#${config.logsChannelId}>` : 'Non configure'}\n\n` +
                '**Tickets normaux :** Equipe Staff et roles superieurs\n' +
                '**Plainte Staff :** Gerance/Fondation, personne concernee exclue\n' +
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
            content: ` ${role} ajoute dans **${category}**.`,
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
            content: ` ${role} retire de la hierarchie.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (sub === 'voir') {
          let content = '#  HIERARCHIE CONFIGUREE\n\n';
          for (const category of HIERARCHY_CATEGORIES) {
            content += `## ${category}\n`;
            content += hierarchy[category].length
              ? `${hierarchy[category].map(id => `<@&${id}>`).join('\n')}\n\n`
              : '> Aucun role\n\n';
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
            content: ' Hierarchie videe.',
            flags: MessageFlags.Ephemeral
          });
        }
      }

      if (interaction.commandName === 'hierarchie') {
        if (!isConfigAuthorized(interaction.user)) {
          return interaction.reply({
            content: ' Vous netes pas autorise.',
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
          .setPlaceholder('Selectionnez le membre du staff concerne')
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.reply({
          content: ' Selectionnez la personne concernee. Elle sera totalement exclue du ticket.',
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
          content: ' Vous ne pouvez pas vous selectionner vous-meme.',
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
          content: ' Ce dossier est introuvable ou ferme.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:claim') {
        if (!canHandleTicket(interaction.member, ticket)) {
          return interaction.reply({
            content: ' Vous ne pouvez pas prendre en charge ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        if (ticket.claimedBy) {
          return interaction.reply({
            content: ` Deja pris en charge par <@${ticket.claimedBy}>.`,
            flags: MessageFlags.Ephemeral
          });
        }

        ticket.claimedBy = interaction.user.id;
        writeJson(TICKETS_FILE, ticketsData);
        await refreshTicketMessage(interaction.channel, ticket);

        await interaction.reply({
          content: ` Dossier pris en charge par ${interaction.user}.`,
          allowedMentions: { users: [interaction.user.id] }
        });

        return sendTicketLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(` Dossier pris en charge - ${ticket.reference}`)
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
            content: ' Seul le responsable, la Gerance ou une personne autorisee peut liberer ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        ticket.claimedBy = null;
        writeJson(TICKETS_FILE, ticketsData);
        await refreshTicketMessage(interaction.channel, ticket);

        return interaction.reply({
          content: ` Dossier libere par ${interaction.user}.`,
          allowedMentions: { users: [interaction.user.id] }
        });
      }

      if (interaction.customId === 'ticket:add_member') {
        if (!canHandleTicket(interaction.member, ticket)) {
          return interaction.reply({
            content: ' Vous ne pouvez pas ajouter de membre.',
            flags: MessageFlags.Ephemeral
          });
        }

        const selector = new UserSelectMenuBuilder()
          .setCustomId('ticket:add_member_select')
          .setPlaceholder('Selectionnez un membre a ajouter')
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.reply({
          content: 'Selectionnez le membre a ajouter.',
          components: [new ActionRowBuilder().addComponents(selector)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:remove_member') {
        if (!canHandleTicket(interaction.member, ticket)) {
          return interaction.reply({
            content: ' Vous ne pouvez pas retirer de membre.',
            flags: MessageFlags.Ephemeral
          });
        }

        const selector = new UserSelectMenuBuilder()
          .setCustomId('ticket:remove_member_select')
          .setPlaceholder('Selectionnez un membre a retirer')
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.reply({
          content: 'Selectionnez le membre a retirer.',
          components: [new ActionRowBuilder().addComponents(selector)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:transcript') {
        if (!canHandleTicket(interaction.member, ticket) && interaction.user.id !== ticket.ownerId) {
          return interaction.reply({
            content: ' Vous ne pouvez pas generer la transcription.',
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const file = await makeTranscript(interaction.channel, ticket);

        await interaction.editReply({
          content: ` Transcription de **${ticket.reference}** :`,
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
            content: ' Vous ne pouvez pas fermer ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        const confirm = new ButtonBuilder()
          .setCustomId('ticket:close_confirm')
          .setLabel('Confirmer la fermeture')
          .setStyle(ButtonStyle.Danger);

        const cancel = new ButtonBuilder()
          .setCustomId('ticket:close_cancel')
          .setLabel('Annuler')
          .setStyle(ButtonStyle.Secondary);

        return interaction.reply({
          content:
            ' **Confirmation**\nUne transcription sera creee avant la suppression du salon.',
          components: [new ActionRowBuilder().addComponents(confirm, cancel)],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'ticket:close_cancel') {
        return interaction.update({
          content: ' Fermeture annulee.',
          components: []
        });
      }

      if (interaction.customId === 'ticket:close_confirm') {
        const allowed =
          interaction.user.id === ticket.ownerId ||
          canHandleTicket(interaction.member, ticket);

        if (!allowed) {
          return interaction.reply({
            content: ' Vous ne pouvez pas fermer ce dossier.',
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.update({
          content: ' Fermeture en cours...',
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
            .setTitle(` Dossier ferme - ${ticket.reference}`)
            .addFields(
              { name: 'Createur', value: `<@${ticket.ownerId}>`, inline: true },
              { name: 'Responsable', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Aucun', inline: true },
              { name: 'Ferme par', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp(),
          [transcript]
        );

        try {
          const owner = await client.users.fetch(ticket.ownerId);
          if (ticket.type !== 'plainte_staff' || owner.id !== ticket.concernedUserId) {
            await owner.send({
              content: ` Transcription de votre dossier **${ticket.reference}**.`,
              files: [await makeTranscript(interaction.channel, ticket)]
            });
          }
        } catch {
          // Les MP peuvent etre fermes.
        }

        setTimeout(async () => {
          try {
            await interaction.channel.delete(`Dossier ${ticket.reference} ferme`);
          } catch (error) {
            console.error(' Suppression du ticket impossible :', error?.message || error);
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
          content: ' Ce dossier est introuvable.',
          components: []
        });
      }

      if (!canHandleTicket(interaction.member, ticket)) {
        return interaction.update({
          content: ' Vous ne pouvez pas modifier les acces.',
          components: []
        });
      }

      const userId = interaction.values[0];

      if (interaction.customId === 'ticket:add_member_select') {
        if (ticket.concernedUserId === userId) {
          return interaction.update({
            content: ' La personne concernee par la plainte ne peut jamais etre ajoutee.',
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
          content: ` <@${userId}> a ete ajoute au dossier.`,
          components: [],
          allowedMentions: { users: [userId] }
        });
      }

      if (userId === ticket.ownerId) {
        return interaction.update({
          content: ' Le createur du dossier ne peut pas etre retire.',
          components: []
        });
      }

      await interaction.channel.permissionOverwrites.delete(userId).catch(() => {});
      ticket.addedUserIds = ticket.addedUserIds.filter(id => id !== userId);
      writeJson(TICKETS_FILE, ticketsData);

      return interaction.update({
        content: ` <@${userId}> a ete retire du dossier.`,
        components: [],
        allowedMentions: { users: [userId] }
      });
    }
  } catch (error) {
    console.error(' Interaction impossible :', error);

    const payload = {
      content: ' Une erreur est survenue.',
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
    console.warn(' Discord a signale un salon introuvable (10003). Le ticket sera nettoye automatiquement.');
    return;
  }

  console.error(' Discord :', error);
});
process.on('unhandledRejection', error => console.error(' Promesse non geree :', error));
process.on('uncaughtException', error => console.error(' Erreur non interceptee :', error));

let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(` ${signal} recu : arret propre.`);
  client.destroy();
  setTimeout(() => process.exit(0), 250);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

client.login(process.env.TOKEN);
