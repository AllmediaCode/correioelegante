require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());

// ─── Serve o site estático ────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Bot do Discord ───────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ]
});

client.once('ready', () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
});

// Retry automático respeitando o rate limit do Discord
async function fetchMembersWithRetry(guild) {
  let lastError;
  for (let i = 0; i < 5; i++) {
    try {
      return await guild.members.fetch();
    } catch (err) {
      lastError = err;
      const seconds = parseFloat((err.message || '').replace(/.*Retry after ([0-9.]+).*/i, '$1'));
      const wait = !isNaN(seconds) ? Math.ceil(seconds * 1000) + 500 : 3000;
      console.warn('Rate limit. Aguardando ' + wait + 'ms (tentativa ' + (i+1) + '/5)...');
      await new Promise(function(r){ setTimeout(r, wait); });
    }
  }
  throw lastError;
}

client.login(process.env.DISCORD_TOKEN);

// ─── Rota: retorna todos os membros do servidor ───────────────────
app.get('/membros', async (req, res) => {
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const members = await fetchMembersWithRetry(guild);

    const lista = members
      .filter(m => !m.user.bot) // exclui bots
      .map(m => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.nickname || m.user.globalName || m.user.username,
        avatar: m.user.displayAvatarURL({ size: 64 }),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json(lista);
  } catch (err) {
    console.error('Erro ao buscar membros:', err.message);
    res.status(500).json({ error: 'Erro ao buscar membros: ' + err.message });
  }
});

// ─── Rota: recebe cartinha do front-end ───────────────────────────
app.post('/enviar', upload.single('file'), async (req, res) => {
  const { to, from, message } = req.body;
  const pngBuffer = req.file?.buffer;

  if (!to || !pngBuffer) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  try {
    // Busca o servidor (guild) configurado
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);

    // Busca os membros (carrega o cache primeiro)
    await fetchMembersWithRetry(guild);

    // Procura o usuário pelo username do Discord (ex: "anasilva")
    const member = guild.members.cache.find(m =>
      m.user.username.toLowerCase() === to.toLowerCase() ||
      m.user.globalName?.toLowerCase() === to.toLowerCase()
    );

    if (!member) {
      return res.status(404).json({ error: `Usuário "${to}" não encontrado no servidor.` });
    }

    // Abre DM e envia
    const dmChannel = await member.createDM();
    const attachment = new AttachmentBuilder(pngBuffer, { name: 'cartinha.png' });

    await dmChannel.send({
      content: `💌 **Você recebeu uma cartinha de Festa Junina!**\n*De: ${from}*`,
      files: [attachment]
    });

    console.log(`✉️  Cartinha enviada para ${member.user.username} (de: ${from})`);
    res.json({ ok: true, message: `Cartinha enviada para ${member.user.username}!` });

  } catch (err) {
    console.error('Erro ao enviar DM:', err.message);

    if (err.code === 50007) {
      return res.status(400).json({ error: 'O usuário bloqueou DMs de membros do servidor.' });
    }

    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

// ─── Rota de health check ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: client.user?.tag || 'conectando...' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
