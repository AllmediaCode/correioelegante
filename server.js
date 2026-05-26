require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Bot ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ─── Cache de membros (carregado UMA vez ao iniciar) ─────────────
let membrosCache = [];
let cacheStatus  = 'aguardando'; // 'aguardando' | 'carregando' | 'pronto' | 'erro'

async function carregarMembros() {
  cacheStatus = 'carregando';
  const maxTentativas = 5;

  for (let i = 0; i < maxTentativas; i++) {
    try {
      console.log(`Buscando membros no servidor... (tentativa ${i + 1}/${maxTentativas})`);
      const guild   = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const members = await guild.members.fetch();

      membrosCache = members
        .filter(m => !m.user.bot)
        .map(m => ({
          id:          m.user.id,
          username:    m.user.username,
          displayName: m.nickname || m.user.globalName || m.user.username,
          avatar:      m.user.displayAvatarURL({ size: 64 }),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      cacheStatus = 'pronto';
      console.log(`✅ ${membrosCache.length} membros carregados e em cache.`);
      return;

    } catch (err) {
      const raw     = parseFloat((err.message || '').replace(/.*Retry after ([0-9.]+).*/i, '$1'));
      const waitMs  = !isNaN(raw) ? Math.ceil(raw * 1000) : 3000;
      const waitSec = (waitMs / 1000).toFixed(1);

      if (i < maxTentativas - 1) {
        // Countdown no terminal
        console.log(`Buscando membros — aguardando ${waitSec}s antes da próxima tentativa...`);
        let remaining = Math.ceil(parseFloat(waitSec));
        await new Promise(resolve => {
          const tick = setInterval(() => {
            process.stdout.write(`\r  ${remaining}s restantes...   `);
            remaining--;
            if (remaining < 0) { clearInterval(tick); process.stdout.write('\n'); resolve(); }
          }, 1000);
        });
      } else {
        cacheStatus = 'erro';
        console.error('Não foi possível carregar membros após várias tentativas:', err.message);
      }
    }
  }
}

client.once('ready', () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  carregarMembros();
});

client.login(process.env.DISCORD_TOKEN);

// ─── Rota: status do cache (usada pelo front para auto-atualizar) ─
app.get('/status', (req, res) => {
  res.json({ status: cacheStatus, total: membrosCache.length });
});

// ─── Rota: retorna membros do cache ──────────────────────────────
app.get('/membros', (req, res) => {
  if (cacheStatus === 'pronto') {
    return res.json(membrosCache);
  }
  if (cacheStatus === 'carregando' || cacheStatus === 'aguardando') {
    return res.status(202).json({ error: 'carregando', status: cacheStatus });
  }
  res.status(500).json({ error: 'Falha ao carregar membros. Reinicie o servidor.' });
});

// ─── Rota: enviar cartinha via DM ─────────────────────────────────
app.post('/enviar', upload.single('file'), async (req, res) => {
  const { to, from, message } = req.body;
  const pngBuffer = req.file?.buffer;

  if (!to || !pngBuffer) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  const membro = membrosCache.find(m =>
    m.username.toLowerCase() === to.toLowerCase()
  );

  if (!membro) {
    return res.status(404).json({ error: `Usuário "${to}" não encontrado.` });
  }

  try {
    const guild      = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member     = await guild.members.fetch(membro.id);
    const dmChannel  = await member.createDM();
    const attachment = new AttachmentBuilder(pngBuffer, { name: 'cartinha.png' });

    await dmChannel.send({
      content: `💌 **Você recebeu uma cartinha de Festa Junina!**\n*De: ${from}*`,
      files: [attachment],
    });

    console.log(`✉️  Cartinha enviada para ${membro.username} (de: ${from})`);
    res.json({ ok: true, message: `Cartinha enviada para ${membro.username}!` });

  } catch (err) {
    console.error('Erro ao enviar DM:', err.message);
    if (err.code === 50007) {
      return res.status(400).json({ error: 'O usuário bloqueou DMs de membros do servidor.' });
    }
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
