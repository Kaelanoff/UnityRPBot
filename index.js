const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
require('dotenv').config();

if (!process.env.TOKEN) {
  console.error('❌ TOKEN manquant.');
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

client.once(Events.ClientReady, readyClient => {
  console.log('✅ UNITY RP BOT CONNECTÉ');
  console.log(`🤖 Nom : ${readyClient.user.tag}`);
  console.log(`🆔 ID : ${readyClient.user.id}`);
  console.log(`🌐 Serveurs : ${readyClient.guilds.cache.size}`);
});

client.login(process.env.TOKEN);