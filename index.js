const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Menyimpan sesi game aktif per user
const activeGames = {};
global.activeTebak = {};
global.activeFamily100 = {};
global.activePin = {};

// Daftar Nomor Pro / Owner (Unlimited & Full Akses Admin)
const proUsers = [
    '6287852063799',
    '265893221261392'
];

// Path file untuk database premium otomatis dan users/levels
const premiumFile = './premium.json';
const usersFile = './users.json';
const levelsFile = './levels.json';
        
// Fungsi membaca data database dari file JSON
function getUsersData() {
    try { if (fs.existsSync(usersFile)) return JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) {}
    return {};
}
function saveUsersData(data) {
    try { fs.writeFileSync(usersFile, JSON.stringify(data, null, 2)); } catch (e) {}
}

function getPremiumUsers() {
    try {
        if (fs.existsSync(premiumFile)) {
            const data = fs.readFileSync(premiumFile, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('Gagal membaca database premium:', e);
    }
    return [];
}

function savePremiumUsers(users) {
    try {
        fs.writeFileSync(premiumFile, JSON.stringify(users, null, 2));
    } catch (e) {
        console.log('Gagal menyimpan database premium:', e);
    }
}

// Penyimpanan limit harian public user
const userLimits = {};
const DAILY_LIMIT = 15;

// Fungsi untuk mendapatkan tanggal hari ini format YYYY-MM-DD
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

// Untuk menghitung waktu aktif (runtime) bot
const startTime = Date.now();
function getRuntime(uptime) {
    const seconds = Math.floor((uptime / 1000) % 60);
    const minutes = Math.floor((uptime / (1000 * 60)) % 60);
    const hours = Math.floor((uptime / (1000 * 60 * 60)) % 24);
    return `${hours} jam ${minutes} menit ${seconds} detik`;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessions');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menghubungkan kembali...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Berhasil Terhubung!');
        }
    });

    // Handler Pesan Masuk & Command
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        
        // JANGAN RESPON PESAN DARI BOT SENDIRI (Mencegah Spam/Looping)
        if (m.key.fromMe) return; 

        const messageType = Object.keys(m.message)[0];
        // ... kode selanjutnya tetap seperti biasa
let body = m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || '';
body = body || '';

        const remoteJid = m.key.remoteJid;
        
        // Menggunakan nama unik 'isGroupChat' agar tidak bentrok dengan baris 259
        const isGroupChat = remoteJid.endsWith('@g.us');
        
        // sender asli khusus untuk database, koin, dan limit harian
        const realSender = m.key.fromMe ? sock.user.id : (m.key.participant || remoteJid);
        const senderNumber = realSender.replace(/[^0-9]/g, '');

        // Variabel 'sender' diarahkan ke remoteJid agar semua sock.sendMessage(sender, ...) otomatis membalas ke grup/PC dengan akurat
        const sender = remoteJid;

        const isPro = proUsers.some(num => sender.includes(num) || senderNumber.includes(num));
        const premiumList = getPremiumUsers();
        const isPrem = premiumList.some(num => senderNumber.includes(num));

        // ==========================================
        // PENGECEKAN GAME AKTIF (SEBELUM TEKS BIASA)
        // ==========================================

        // 1. Pengecekan Tebak Angka Aktif
        if (activeGames[sender] && !body.startsWith('.')) {
            const userGuess = parseInt(body.trim());
            if (!isNaN(userGuess)) {
                const target = activeGames[sender];
                if (userGuess === target) {
                    await sock.sendMessage(sender, { text: `🎉 **SELAMAT, TEBAKANMU BENAR!** 🎉\nAngka rahasianya adalah *${target}*. Hebat banget!` });
                    delete activeGames[sender];
                } else if (userGuess < target) {
                    await sock.sendMessage(sender, { text: `❌ Tebakanmu terlalu **KECIL**! Coba angka yang lebih besar.` });
                } else {
                    await sock.sendMessage(sender, { text: `❌ Tebakanmu terlalu **BESAR**! Coba angka yang lebih kecil.` });
                }
                return;
            }
        }

        // 2. Pengecekan Game Tebak Kata / Kalimat Aktif
        if (global.activeTebak && global.activeTebak[sender] && !body.startsWith('.')) {
            const userAnswer = body.trim().toLowerCase();
            const correctAnswer = global.activeTebak[sender].answer.toLowerCase();
            if (userAnswer === correctAnswer) {
                await sock.sendMessage(sender, { text: `🎉 **JAWABAN BENAR!** 🎉\nHebat, tebakanmu tepat sekali.` }, { quoted: m });
                delete global.activeTebak[sender];
                return;
            } else {
                await sock.sendMessage(sender, { text: `❌ **SALAH!** Masih belum tepat, coba lagi.` }, { quoted: m });
                return;
            }
        }

        // 3. Pengecekan Game Family 100 Aktif
        if (global.activeFamily100 && global.activeFamily100[sender] && !body.startsWith('.')) {
            const userAns = body.trim().toLowerCase();
            const session = global.activeFamily100[sender];
            const index = session.jawaban.indexOf(userAns);

            if (index !== -1) {
                if (session.terjawab[index]) {
                    await sock.sendMessage(sender, { text: `⚠️ Jawaban "${userAns}" sudah pernah ditebak sebelumnya!` }, { quoted: m });
                } else {
                    session.terjawab[index] = true;
                    const sisa = session.terjawab.filter(v => !v).length;
                    let statusList = session.jawaban.map((ans, i) => session.terjawab[i] ? `✅ ${ans}` : `🔒 [ Tersembunyi ]`).join('\n');
                    
                    if (sisa === 0) {
                        await sock.sendMessage(sender, { text: `🎉 **LUAR BIASA! SEMUA JAWABAN TERTEBAK!** 🎉\n\n${statusList}` }, { quoted: m });
                        delete global.activeFamily100[sender];
                    } else {
                        await sock.sendMessage(sender, { text: `🎯 **BENAR!** Jawabanmu ada dalam daftar.\n\n${statusList}\n\n_Sisa jawaban tersembunyi: ${sisa}_` }, { quoted: m });
                    }
                }
                return;
            }
        }

        // 4. Pengecekan Game Tebak PIN Aktif
        if (global.activePin && global.activePin[sender] && !body.startsWith('.')) {
            const userPinInput = body.trim();
            if (/^\d{4}$/.test(userPinInput)) {
                const sessionPin = global.activePin[sender];
                sessionPin.percobaan++;
                
                if (userPinInput === sessionPin.pin) {
                    await sock.sendMessage(sender, { 
                        text: `🎉 **BERHASIL! PIN BENAR!** 🎉\n\n` +
                              `🔓 PIN Rahasia: *${sessionPin.pin}*\n` +
                              `📊 Total Percobaan: *${sessionPin.percobaan}x tebakan*\n\n` +
                              `Hebat sekali! Keamanan sistem berhasil dibobol! 😎` 
                    }, { quoted: m });
                    delete global.activePin[sender];
                } else {
                    let hint = userPinInput < sessionPin.pin ? "📈 Terlalu **KECIL** (Naikkan angkanya)" : "📉 Terlalu **BESAR** (Turunkan angkanya)";
                    await sock.sendMessage(sender, { 
                        text: `❌ **SALAH!** PIN ${userPinInput} keliru.\n` +
                              `💡 Petunjuk: ${hint}\n` +
                              `🔄 Percobaan ke-${sessionPin.percobaan}. Ayo coba lagi!` 
                    }, { quoted: m });
                }
                return;
            }
        }

        // Pengecekan Tombol Surrender / Nyerah untuk Semua Game Aktif
        if (!body.startsWith('.')) {
            const lowerBodyInput = body.trim().toLowerCase();
            if (['nyerah', 'surrender', 'keluar'].includes(lowerBodyInput)) {
                let statusNyerah = false;
                let pesanJawaban = "🏳️ **KAMU MENYERAH!**\n\n";

                if (activeGames[sender]) {
                    pesanJawaban += `Angka rahasianya adalah: *${activeGames[sender]}*`;
                    delete activeGames[sender];
                    statusNyerah = true;
                } else if (global.activeTebak && global.activeTebak[sender]) {
                    pesanJawaban += `Jawaban yang benar adalah: *${global.activeTebak[sender].answer}*`;
                    delete global.activeTebak[sender];
                    statusNyerah = true;
                } else if (global.activeFamily100 && global.activeFamily100[sender]) {
                    const sess = global.activeFamily100[sender];
                    pesanJawaban += `Daftar jawaban Family 100:\n` + sess.jawaban.map((ans, i) => `• ${ans}`).join('\n');
                    delete global.activeFamily100[sender];
                    statusNyerah = true;
                } else if (global.activePin && global.activePin[sender]) {
                    pesanJawaban += `PIN rahasia yang benar adalah: *${global.activePin[sender].pin}*`;
                    delete global.activePin[sender];
                    statusNyerah = true;
                }

                if (statusNyerah) {
                    await sock.sendMessage(sender, { text: `${pesanJawaban}\n\n_Tombol surrend ada di ketikan!_ 😜` }, { quoted: m });
                    return;
                }
            }
        }

        // Penanganan Pesan Teks Biasa Tanpa Titik
        const lowerBody = body.trim().toLowerCase();
        if (!body.startsWith('.')) {
            if (['p', 'p min', 'p bot', 'hai', 'halo'].includes(lowerBody)) {
                await sock.sendMessage(sender, { text: 'P juga! Ketik *.menu* untuk melihat daftar fitur bot ya. 😊' }, { quoted: m });
                return;
            } else {
                await sock.sendMessage(sender, { text: `❌ Pesan atau perintah "${body}" tidak dikenali. Ketik .menu untuk melihat daftar command yang tersedia!` }, { quoted: m });
                return;
            }
        }

        const today = getTodayDate();
        
        // Cek apakah pesan berasal dari Private Chat (bukan grup) dan user bukan Pro/Prem
        const isGroup = sender.endsWith('@g.us');
        if (!isGroup && !isPro && !isPrem) {
            if (!userLimits[senderNumber] || userLimits[senderNumber].date !== today) {
                userLimits[senderNumber] = { count: 0, date: today };
            }
        }

        const isCmd = body.startsWith('.');
        
        // Limit hanya dikurangi jika pesan berasal dari PC (bukan grup)
        if (isCmd && !isGroup && !isPro && !isPrem) {
            if (userLimits[senderNumber].count >= DAILY_LIMIT) {
                await sock.sendMessage(sender, { 
                    text: `⚠️ *Batas Limit Harian Tercapai!*\n\nHalo, kuota penggunaan gratis harianmu (${DAILY_LIMIT} command) di chat pribadi sudah habis dan akan **reset otomatis pukul 00.00**. \n\n✨ Ingin akses *unlimited* tanpa batas? Ketik *.premium* untuk info cara upgrade!` 
                });
                return;
            }
            userLimits[senderNumber].count++;
        }

        const userStatusLabel = isPro ? '🔥 PRO USER (Owner)' : (isPrem ? '⭐ PREMIUM USER' : `🌐 PUBLIC USER (Sisa Limit: ${DAILY_LIMIT - (userLimits[senderNumber]?.count || 0)}/${DAILY_LIMIT})`);

        const command = isCmd ? body.slice(1).trim().split(' ')[0].toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);

        if (isCmd) {
            console.log(`Command diterima: .${command} dari ${sender} [Limit: ${isPro || isPrem ? 'UNLIMITED' : userLimits[senderNumber]?.count}/${DAILY_LIMIT}]`);
        }

        switch (command) {

            case 'menu':
            case 'help': {
                const uptimeFormatted = getRuntime(Date.now() - startTime);
                await sock.sendMessage(sender, { 
                    image: fs.readFileSync('./menu.jpg'), 
                    caption: 
`╔══════════════════════╗
║     🌟 **ASISTEN BOT** 🌟     
╚══════════════════════╝
│ 👑 **Owner**    : Kai
│ 🤖 **Bot Name** : Asisten Bot
│ ⚡ **Version**  : 5.2.0 (Public Version)
│ 🛠️ **Platform** : Acode Alpine
│ 🌐 **Mode**     : Public / Baileys
│ 🔗 **TikTok**   : tiktok.com/@al_season1
╚══════════════════════╝

┏━━━ 📊 **SYSTEM STATUS** 📊
┃ 🎯 **Fitur**   : Menu Utama & Utility
┃ ⏰ **Uptime**  : ${uptimeFormatted}
┃ 🌐 **Network** : 🔓 Publik Mode
┃ 💎 **Status**  : ${userStatusLabel}
┗━━━━━━━━━━━━━━━━━━━━━━━

┏━━━ ⚙️ **FEATURE SETTINGS** 
┃ ⚙️ Prefix   : . (Dot)
┃ 🌐 Public   : ✅ ON
┃ 🚫 Anticall : ✅ ON
┃ 📝 Autobio  : ❌ OFF
┃ 👥 Only Grup: ✅ ON
┃ 💬 Only PC  : ✅ ON
┃ 📖 Autoread : ❌ OFF
┃ 🕌 Autoshalat: ❌ OFF
┃ 🔒 Self Mode: ❌ OFF
┗━━━━━━━━━━━━━━━━━━━━━━━

✨ *Halo! Jangan spam bot ya, mungkin ada fitur yang kurang maksimal, jika ada bug atau masukan silakan lapor di .panggilowner, selamat menikmati fitur yang tersedia!* 🐣

┌── 📌 **[ 01 ] MENU UTAMA & INFO**
│ 1. .ping
│ 2. .halo
│ 3. .owner
│ 4. .runtime
│ 5. .speed
│ 6. .status
│ 7. .bio
│ 8. .limit / .sisa
└──

┌── 📌 **[ 02 ] MENU UTILITY & ALAT**
│ 9. .tanggal
│ 10. .jam
│ 11. .hitung [angka]
│ 12. .script
│ 13. .premium
│ 14. .balance / .dompet
│ 15. .tiktokdl
│ 16. .tiktokmp3
│ 17. .igdl
│ 18. .ytmp4
│ 19. .igstalk
│ 20. .ttstalk
│ 21. .ai
│ 22. .s / .sticker
│ 23. .tourl
│ 24. .hd
│ 25. .toimg
│ 26. .translate / .tr
│ 27. .qr
│ 28. .cekhost
│ 29. .cekml
│ 30. .cekff
│ 31. .claim
│ 32. .level / .rank
│ 33. .leaderboard
│ 34. .menfess
│ 35. .addprem
│ 36. .delprem
│ 37. .balas
│ 38. .rules
│ 39. .server
└──

┌── 📌 **[ 03 ] MENU HIBURAN & FUN**
│ 40. .qt
│ 41. .salam
│ 42. .pantun
│ 43. .tebak
│ 44. .family100 / .f100
│ 45. .pin (Game PIN)
│ 46. .fakta
│ 47. .faktadunia
│ 48. .lirik
│ 49. .khodam
│ 50. .cuaca
│ 51. .rate
│ 52. .galau
│ 53. .motivasi
│ 54. .katailmu
│ 55. .gombal
│ 56. .jodoh
│ 57. .dadu
│ 58. .cekganteng
│ 59. .tebakangka
│ 60. .slot
│ 61. .tod
└──

┌── 📌 **[ 04 ] MENU ISLAMI & RELIGI**
│ 62. .asmaulhusna
│ 63. .doa
│ 64. .hadits
│ 65. .quran
└──

┌── 📌 **[ 05 ] MENU BANTUAN & LAINNYA**
│ 66. .donasi
│ 67. .feedback
│ 68. .tips
│ 69. .creator
│ 70. .tiktok
│ 71. .panggilowner
│ 72. .help
└──` 
                });
                break;
            }

            case 'ping':
                await sock.sendMessage(sender, { text: `Pong! Bot aktif (${isPro || isPrem ? 'Akses Unlimited' : 'Akses Publik Berbatas'}).` });
                break;

            case 'halo':
                await sock.sendMessage(sender, { text: 'Halo juga! Ada yang bisa dibantu hari ini?' });
                break;

            case 'ttstalk':
            case 'tiktokstalk': {
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.ttstalk al_season1*' }, { quoted: m });
                    return;
                }
                const username = args[0].replace('@', '');
                await sock.sendMessage(sender, { text: `⏳ Sedang memeriksa akun TikTok @${username}...` }, { quoted: m });
                try {
                    const fetch = (await import('node-fetch')).default;
                    const res = await fetch(`https://api.siputzx.my.id/api/stalk/tiktok?username=${encodeURIComponent(username)}`);
                    const json = await res.json();
                    const data = json.data || json.result;
                    
                    if (data) {
                        const txt = `📱 **TIKTOK STALK** 📱\n\n` +
                                    `• **Username:** ${data.username || username}\n` +
                                    `• **Nickname:** ${data.nickname || '-'}\n` +
                                    `• **Followers:** ${data.follower || data.followers || '-'}\n` +
                                    `• **Following:** ${data.following || '-'}\n` +
                                    `• **Bio:** ${data.signature || '-'}`;
                        await sock.sendMessage(sender, { text: txt }, { quoted: m });
                    } else {
                        throw new Error('Data tidak ditemukan');
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: `❌ Gagal mengambil data TikTok @${username}. Pastikan username-nya benar!` }, { quoted: m });
                }
                break;
            }

            case 'igstalk':
            case 'instagramstalk': {
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.igstalk username*' }, { quoted: m });
                    return;
                }
                const igUser = args[0].replace('@', '');
                await sock.sendMessage(sender, { text: `⏳ Sedang memeriksa akun Instagram @${igUser}...` }, { quoted: m });
                try {
                    const fetch = (await import('node-fetch')).default;
                    const res = await fetch(`https://api.siputzx.my.id/api/stalk/instagram?username=${encodeURIComponent(igUser)}`);
                    const json = await res.json();
                    const data = json.data || json.result;
                    
                    if (data) {
                        const txt = `📸 **INSTAGRAM STALK** 📸\n\n` +
                                    `• **Username:** ${data.username || igUser}\n` +
                                    `• **Fullname:** ${data.full_name || '-'}\n` +
                                    `• **Followers:** ${data.followers || '-'}\n` +
                                    `• **Following:** ${data.following || '-'}\n` +
                                    `• **Posts:** ${data.posts || '-'}`;
                        await sock.sendMessage(sender, { text: txt }, { quoted: m });
                    } else {
                        throw new Error('Data tidak ditemukan');
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: `❌ Gagal mengambil data Instagram @${igUser}.` }, { quoted: m });
                }
                break;
            }

            case 'ai':
            case 'grok': {
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.ai Siapa penemu lampu bohlam?*' }, { quoted: m });
                    return;
                }
                
                const promptText = args.join(' ');
                await sock.sendMessage(sender, { text: `⏳ Sedang berpikir...` }, { quoted: m });

                try {
                    const fetch = (await import('node-fetch')).default;
                    
                    // Menggunakan endpoint API publik alternatif yang aktif
                    const response = await fetch(`https://api.vhtear.com/gpt?text=${encodeURIComponent(promptText)}`);
                    const res = await response.json();
                    
                    const replyText = res.result || res.data || res.message;

                    if (replyText) {
                        await sock.sendMessage(sender, { text: `🤖 **AI ASSISTANT**\n\n${replyText}` }, { quoted: m });
                    } else {
                        await sock.sendMessage(sender, { text: `⚠️ Respons kosong dari server AI.` }, { quoted: m });
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: `❌ Error Sistem: ${e.message}` }, { quoted: m });
                }
                break;
            }

case 's': case 'stiker': {
    try {
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        let mediaObj = quoted?.imageMessage || m.message?.imageMessage;
        if (!mediaObj) {
            await sock.sendMessage(sender, { text: 'Reply gambar pakai.s mas' }, { quoted: m });
            break;
        }
        // download gambar
        const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
        const stream = await downloadContentFromMessage(mediaObj, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // convert JPG -> WEBP lewat API gratis (gak perlu sharp)
        await sock.sendMessage(sender, { text: '⏳ Bentar, lagi bikin stiker...' }, { quoted: m });

        const formData = new FormData();
        formData.append('file', new Blob([buffer]), 'image.jpg');

        const res = await fetch('https://api.ryzendesu.vip/api/converter/jpg-to-webp', {
            method: 'POST',
            body: formData
        });
        const webpBuffer = Buffer.from(await res.arrayBuffer());

        await sock.sendMessage(sender, { sticker: webpBuffer }, { quoted: m });

    } catch (e) {
        console.log('API gagal, kirim manual:', e.message);
        // kalau API gagal, kirim apa adanya (biar gak error)
        try {
            const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const mediaObj = quoted?.imageMessage || m.message?.imageMessage;
            const stream = await downloadContentFromMessage(mediaObj, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(sender, { sticker: buffer }, { quoted: m });
        } catch (err) {
            await sock.sendMessage(sender, { text: 'Gagal mas, internetnya lemot: ' + e.message }, { quoted: m });
        }
    }
    break;
}

            case 'tr':
            case 'translate': {
                if (args.length < 2) {
                    await sock.sendMessage(sender, { 
                        text: `❌ Format salah!\n\nContoh penggunaan:\n*.tr id Hello world* (artinya menerjemahkan ke bahasa Indonesia)\n*.tr en Selamat pagi* (artinya menerjemahkan ke bahasa Inggris)` 
                    }, { quoted: m });
                    return;
                }

                const targetLang = args[0];
                const textToTranslate = args.slice(1).join(' ');

                try {
                    const fetch = (await import('node-fetch')).default;
                    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
                    
                    const response = await fetch(url);
                    const res = await response.json();

                    if (res && res[0]) {
                        let translatedText = '';
                        res[0].forEach(item => {
                            if (item[0]) translatedText += item[0];
                        });

                        await sock.sendMessage(sender, { 
                            text: `🌐 **TRANSLATE**\n\n• **Ke Bahasa:** ${targetLang.toUpperCase()}\n• **Teks Asli:** ${textToTranslate}\n• **Hasil:** ${translatedText}` 
                        }, { quoted: m });
                    } else {
                        throw new Error('Gagal menerjemahkan teks');
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: `❌ Gagal melakukan terjemahan. Periksa kembali kode bahasa tujuan (contoh: id, en, ja, ar, dll).` }, { quoted: m });
                }
                break;
            }

            case 'owner':
            case 'creator':
            case 'pembuat': {
                const ownerNumber = '6287852063799';
                const ownerName = 'Kai';
                const vcard = 'BEGIN:VCARD\n' +
                              'VERSION:3.0\n' +
                              `FN:${ownerName}\n` +
                              `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}\n` +
                              'END:VCARD';
                await sock.sendMessage(sender, { 
                    contacts: { 
                        displayName: ownerName, 
                        contacts: [{ vcard }] 
                    } 
                });
                break;
            }

            case 'runtime':
            case 'uptime':
                await sock.sendMessage(sender, { text: `Bot telah aktif selama: ${getRuntime(Date.now() - startTime)}` });
                break;

            case 'speed':
            case 'ping2':
                await sock.sendMessage(sender, { text: 'Kecepatan respon stabil dan ngebut tanpa kendala di Acode Alpine Linux!' });
                break;

            case 'status':
                await sock.sendMessage(sender, { text: `Status Sistem: 🟢 Normal | Hak Akses Anda: ${userStatusLabel}` });
                break;

            case 'bio':
                await sock.sendMessage(sender, { text: 'Bot WhatsApp multifungsi yang dirancang khusus untuk menemani aktivitas dan manajemen chat.' });
                break;

            case 'tiktok':
            case 'tt':
                await sock.sendMessage(sender, { text: 'Jangan lupa follow TikTok owner ya\n\n🔗 https://tiktok.com/@al_season1' });
                break;

            case 'tanggal': {
                const currentDate = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                await sock.sendMessage(sender, { text: `Waktu & Tanggal hari ini: ${currentDate}` });
                break;
            }

            case 'jam': {
                const currentTime = new Date().toLocaleTimeString('id-ID');
                await sock.sendMessage(sender, { text: `Jam saat ini: ${currentTime} WIB` });
                break;
            }

            case 'hitung':
            case 'math':
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.hitung 198 * 47* atau *.hitung 50 + 50*' });
                } else {
                    try {
                        let expression = args.join(' ');
                        expression = expression.replace(/x/gi, '*').replace(/×/g, '*').replace(/=/g, '');
                        if (/^[0-9+\-*/().\s]+$/.test(expression)) {
                            const result = eval(expression);
                            await sock.sendMessage(sender, { text: `🧮 Hasil dari *${args.join(' ')}* = *${result}*` });
                        } else {
                            await sock.sendMessage(sender, { text: 'Format angka atau operator matematika tidak valid!' });
                        }
                    } catch (e) {
                        await sock.sendMessage(sender, { text: 'Terjadi kesalahan dalam menghitung rumus tersebut.' });
                    }
                }
                break;

            case 'dadu':
            case 'roll': {
                const dice = Math.floor(Math.random() * 6) + 1;
                await sock.sendMessage(sender, { text: `🎲 Angka dadu yang keluar: *[ ${dice} ]*` });
                break;
            }

            case 'jodoh':
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.jodoh Budi & Ani*' });
                } else {
                    const percent = Math.floor(Math.random() * 61) + 40;
                    await sock.sendMessage(sender, { text: `💘 Hasil Cek Jodoh:\nPasangan: *${args.join(' ')}*\nTingkat Kecocokan: *${percent}%*\nSemoga langgeng ya! ✨` });
                }
                break;

            case 'cekganteng':
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.cekganteng Budi*' });
                } else {
                    const persentase = Math.floor(Math.random() * 51) + 50;
                    await sock.sendMessage(sender, { text: `😎 **CEK KETAMPANAN**\nNama: *${args.join(' ')}*\nTingkat Ketampanan: *${persentase}%*\n\nWaduh, aura gantengnya bersinar terang! ✨` });
                }
                break;

            case 'tebakangka': {
                const angkaRahasia = Math.floor(Math.random() * 10) + 1;
                activeGames[sender] = angkaRahasia;
                await sock.sendMessage(sender, { text: `🎮 **GAME TEBAK ANGKA**\nAku sudah memilih angka acak antara *1 sampai 10*.\n\nSilakan ketik angka pilihanmu langsung di chat ini (tanpa titik)!` });
                break;
            }

            case 'pin': {
                const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
                global.activePin[sender] = { pin: randomPin, percobaan: 0 };
                await sock.sendMessage(sender, { 
                    text: `🔐 **GAME TEBAK PIN RAHASIA** 🔐\n\n` +
                          `Bot telah mengacak PIN 4 digit (0000 - 9999).\n` +
                          `Tugasmu adalah menebak angka PIN tersebut dengan mengetik langsung angkanya di chat ini!\n\n` +
                          `_Contoh: 1234_` 
                }, { quoted: m });
                break;
            }

            case 'family100':
            case 'f100': {
                const listFamily = [
                    {
                        soal: "Sebutkan hewan yang sering dipelihara di rumah!",
                        jawaban: ["kucing", "anjing", "burung", "ikan", "kelinci", "hamster"]
                    },
                    {
                        soal: "Apa yang dilakukan orang ketika bangun tidur di pagi hari?",
                        jawaban: ["mandi", "minum", "cuci muka", "berdoa", "merapikan kasur", "hp"]
                    },
                    {
                        soal: "Sebutkan benda yang ada di dalam kamar tidur!",
                        jawaban: ["kasur", "bantal", "selimut", "lemari", "guling", "ac", "lampu"]
                    },
                    {
                        soal: "Makanan apa yang sering disantap saat sarapan?",
                        jawaban: ["nasi goreng", "roti", "bubur", "mie", "telur", "sereal"]
                    }
                ];
                const game = listFamily[Math.floor(Math.random() * listFamily.length)];
                global.activeFamily100[sender] = {
                    soal: game.soal,
                    jawaban: game.jawaban,
                    terjawab: new Array(game.jawaban.length).fill(false)
                };
                let soalText = `🎮 **FAMILY 100** 🎮\n\n` +
                               `💬 **Pertanyaan:** *${game.soal}*\n` +
                               `📊 **Jumlah Jawaban Tersembunyi:** ${game.jawaban.length}\n\n` +
                               `_Silakan ketik jawabanmu langsung di chat ini!_`;
                await sock.sendMessage(sender, { text: soalText }, { quoted: m });
                break;
            }

            case 'tod':
            case 'truthordare': {
                const truths = [
                    "Siapa orang terakhir yang kamu chat sebelum tidur tadi malam?",
                    "Apa hal paling memalukan yang pernah kamu alami di sekolah/tempat umum?",
                    "Pernahkah kamu diam-diam mengambil barang milik teman? Barang apa itu?",
                    "Siapa crush atau orang yang sedang kamu taksir saat ini?",
                    "Apa kebiasaan aneh yang sering kamu lakukan sendirian di kamar?"
                ];
                const dares = [
                    "Kirim VN (Voice Note) bernyanyi lagu anak-anak di chat ini!",
                    "Ketik 'Aku sayang bot buatan owner' sebanyak 3 kali berturut-turut.",
                    "Ganti nama kontak WhatsApp 3 orang teratas di daftar chatmu dengan nama hewan.",
                    "Kirim stiker paling jelek atau lucu yang ada di HP-mu sekarang.",
                    "Ceritakan sebuah lelucon garing di chat ini sampai ada yang tertawa."
                ];
                const randomTruth = truths[Math.floor(Math.random() * truths.length)];
                const randomDare = dares[Math.floor(Math.random() * dares.length)];
                await sock.sendMessage(sender, { text: `🎯 **TRUTH OR DARE (TOD)** 🎯\n\n💬 **TRUTH:**\n_${randomTruth}_\n\n🔥 **DARE:**\n_${randomDare}_\n\nPilih mau jawab Truth atau laksanakan Dare-nya ya! ✨` });
                break;
            }

            case 'faktadunia': {
                const faktaList = [
                    "Waktu satu hari di Planet Venus lebih lama daripada waktu satu tahunnya untuk keliling Matahari!",
                    "Pisang secara alami adalah buah yang bersifat radioaktif karena mengandung kandungan potasium yang tinggi.",
                    "Hampir 99% dari seluruh ruang di alam semesta sebenarnya adalah ruang hampa udara (vakum).",
                    "Sidik jari lidah manusia memiliki pola unik yang berbeda satu sama lain, mirip seperti sidik jari tangan.",
                    "Jantung seekor udang terletak di bagian kepala mereka.",
                    "Cahaya matahari membutuhkan waktu sekitar 8 menit 20 detik untuk sampai ke permukaan Bumi."
                ];
                const randomFakta = faktaList[Math.floor(Math.random() * faktaList.length)];
                await sock.sendMessage(sender, { text: `🌍 **FAKTA DUNIA & SAINS**\n\n_${randomFakta}_\n\nSemoga nambah ilmu baru hari ini! ✨` });
                break;
            }

            case 'script':
            case 'sc':
                await sock.sendMessage(sender, { text: `Bot ini dikoding menggunakan Baileys NodeJS, dijalankan di HP via Acode & Alpine Linux.\nStatus Anda saat ini: ${userStatusLabel}` });
                break;

            case 'premium':
            case 'prem':
                await sock.sendMessage(sender, { 
                    text: 
`🌟 **LAYANAN PREMIUM BOT** 🌟

Insecure karena kuota limit harian habis? Yuk upgrade ke status **PREMIUM** dan nikmati akses tanpa batas (*unlimited*) setiap hari!

🎁 **Keuntungan Premium:**
✨ Akses *unlimited* semua command (Tanpa Limit Harian)
✨ Prioritas respon bot lebih cepat
✨ Bebas menggunakan fitur sepuasnya tanpa khawatir kena batasan

💰 **Daftar Harga:**
• **Rp 5.000** / Bulan
• **Rp 10.000** / Permanen (Selamanya)

🛒 **Cara Pembayaran:**
🔗 Saweria: https://saweria.co/All36
Atau hubungi Owner langsung untuk pembayaran via Dana/OVO/QRIS.

_Setelah transfer, kirim bukti pembayaran beserta nomor WhatsApp-mu ke Owner untuk langsung diaktifkan!_ ✨` 
                });
                break;

            case 'balance':
            case 'dompet': {
                const db = getUsersData();
                if (!db[senderNumber]) db[senderNumber] = { coins: 100, lastClaim: '' };
                await sock.sendMessage(sender, { text: `🪙 Saldo Koin Anda: *${db[senderNumber].coins} Koin*` });
                break;
            }

            case 'tiktokdl':
            case 'ttdl':
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.tiktokdl https://vt.tiktok.com/xxxxxx*' });
                } else {
                    const ttUrl = args[0];
                    await sock.sendMessage(sender, { text: '⏳ Sedang memproses video TikTok, silakan tunggu...' });
                    try {
                        const fetch = (await import('node-fetch')).default;
                        const response = await fetch('https://www.tikwm.com/api/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36'
                            },
                            body: `url=${encodeURIComponent(ttUrl)}&hd=1`
                        });
                        const res = await response.json();
                        const videoUrl = res.data?.play || res.data?.hdplay;

                        if (videoUrl) {
                            await sock.sendMessage(sender, { video: { url: videoUrl }, caption: '🎬 Berhasil mengunduh video TikTok!' });
                        } else {
                            throw new Error('Gagal mendapatkan URL video');
                        }
                    } catch (e) {
                        await sock.sendMessage(sender, { text: '❌ Gagal mengunduh video TikTok. Pastikan link yang dikirim valid!' });
                    }
                }
                break;

            case 'tourl': {
                const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const isQuotedImage = quotedMsg && (quotedMsg.imageMessage || quotedMsg.documentMessage);
                const isDirectImage = m.message.imageMessage || m.message.documentMessage;

                if (isDirectImage || isQuotedImage) {
                    await sock.sendMessage(sender, { text: '⏳ Sedang mengunggah media ke server...' }, { quoted: m });
                    try {
                        const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
                        const fetch = (await import('node-fetch')).default;
                        const FormData = (await import('form-data')).default;
                        
                        const mediaMessage = isDirectImage ? (m.message.imageMessage || m.message.documentMessage) : (quotedMsg.imageMessage || quotedMsg.documentMessage);
                        const mediaType = mediaMessage.mimetype && mediaMessage.mimetype.includes('image') ? 'image' : 'document';
                        
                        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        const form = new FormData();
                        form.append('reqtype', 'fileupload');
                        form.append('fileToUpload', buffer, { filename: 'upload.jpg', contentType: mediaMessage.mimetype || 'image/jpeg' });

                        const uploadRes = await fetch('https://catbox.moe/user/api.php', {
                            method: 'POST',
                            body: form,
                            headers: form.getHeaders()
                        });
                        const linkUrl = await uploadRes.text();

                        if (linkUrl && linkUrl.startsWith('http')) {
                            await sock.sendMessage(sender, { text: `✅ **Berhasil diunggah!**\n\nLink: ${linkUrl.trim()}` }, { quoted: m });
                        } else {
                            throw new Error('Gagal mendapatkan URL dari Catbox.');
                        }
                    } catch (e) {
                        await sock.sendMessage(sender, { text: '❌ Gagal mengunggah media. Pastikan ukuran filenya tidak terlalu besar!' }, { quoted: m });
                    }
                } else {
                    await sock.sendMessage(sender, { text: '❌ Kirim atau balas gambar/dokumen dengan caption *.tourl*!' }, { quoted: m });
                }
                break;
            }

            case 'hd':
            case 'remini':
            case 'upscale': {
                const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const isQuotedImage = quotedMsg && (quotedMsg.imageMessage || quotedMsg.documentMessage);
                const isDirectImage = m.message.imageMessage || m.message.documentMessage;

                if (isDirectImage || isQuotedImage) {
                    await sock.sendMessage(sender, { text: '⏳ Sedang mengunggah gambar untuk diproses...' }, { quoted: m });
                    try {
                        const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
                        const fetch = (await import('node-fetch')).default;
                        const FormData = (await import('form-data')).default;
                        
                        const mediaMessage = isDirectImage ? (m.message.imageMessage || m.message.documentMessage) : (quotedMsg.imageMessage || quotedMsg.documentMessage);
                        const mediaType = mediaMessage.mimetype && mediaMessage.mimetype.includes('image') ? 'image' : 'document';
                        
                        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        const form = new FormData();
                        form.append('reqtype', 'fileupload');
                        form.append('fileToUpload', buffer, { filename: 'image-hd.jpg', contentType: mediaMessage.mimetype || 'image/jpeg' });

                        const uploadRes = await fetch('https://catbox.moe/user/api.php', {
                            method: 'POST',
                            body: form,
                            headers: form.getHeaders()
                        });
                        const imageUrl = await uploadRes.text();

                        if (!imageUrl || !imageUrl.startsWith('http')) {
                            throw new Error('Gagal mengunggah gambar.');
                        }

                        const cleanUrl = imageUrl.trim();
                        const resultText = `✨ *PENINGKATAN KUALITAS GAMBAR (HD)* ✨\n\n` +
                                           `Gambar berhasil diunggah dengan aman! Silakan gunakan link di bawah ini untuk melakukan *AI Upscale* tanpa batas dan tanpa pecah:\n\n` +
                                           `🔗 *Link AI Upscaler / Resize:*\n` +
                                           `https://ezgif.com/resize?url=${encodeURIComponent(cleanUrl)}\n\n` +
                                           `🔗 *Link File Asli (Full Resolusi):*\n` +
                                           `${cleanUrl}\n\n` +
                                           `_Sentuh link resize di atas untuk langsung memperbesar dan mempertajam kualitas gambar!_`;

                        await sock.sendMessage(sender, { text: resultText }, { quoted: m });
                    } catch (e) {
                        await sock.sendMessage(sender, { text: '❌ Gagal memproses gambar. Pastikan ukuran filenya tidak terlalu besar!' }, { quoted: m });
                    }
                } else {
                    await sock.sendMessage(sender, { text: '❌ Kirim atau balas gambar dengan caption *.hd*!' }, { quoted: m });
                }
                break;
            }

            case 'toimg':
            case 'toview': {
                const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const isQuotedSticker = quotedMsg && quotedMsg.stickerMessage;
                const isDirectSticker = m.message.stickerMessage;

                if (isDirectSticker || isQuotedSticker) {
                    await sock.sendMessage(sender, { text: '⏳ Sedang mengubah stiker menjadi gambar...' }, { quoted: m });
                    try {
                        const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
                        const mediaMessage = isDirectSticker ? m.message.stickerMessage : quotedMsg.stickerMessage;
                        const stream = await downloadContentFromMessage(mediaMessage, 'sticker');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        await sock.sendMessage(sender, { image: buffer, caption: '✅ **Berhasil! Stiker telah diubah menjadi gambar.**' }, { quoted: m });
                    } catch (e) {
                        await sock.sendMessage(sender, { text: '❌ Gagal mengubah stiker menjadi gambar. Pastikan itu stiker biasa ya!' }, { quoted: m });
                    }
                } else {
                    await sock.sendMessage(sender, { text: '❌ Kirim atau balas stiker dengan caption *.toimg*!' }, { quoted: m });
                }
                break;
            }

            case 'cekhost':
            case 'host': {
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.cekhost google.com* atau *.cekhost github.com*' }, { quoted: m });
                    return;
                }
                let rawInput = args[0].trim();
                let domain = rawInput.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0].split('?')[0];

                await sock.sendMessage(sender, { text: `⏳ Sedang memeriksa DNS untuk *${domain}*...` }, { quoted: m });
                try {
                    const dns = (await import('dns')).promises;
                    const lookupResult = await dns.lookup(domain);
                    const hostText = `🌐 *CEK HOST / IP DOMAIN* 🌐\n\n` +
                                     `• *Domain:* ${domain}\n` +
                                     `• *IP Address:* ${lookupResult.address}\n` +
                                     `• *Versi IP:* IPv${lookupResult.family}\n\n` +
                                     `_Pemeriksaan DNS berhasil dilakukan!_`;
                    await sock.sendMessage(sender, { text: hostText }, { quoted: m });
                } catch (e) {
                    await sock.sendMessage(sender, { text: `🌐 *CEK HOST: ${domain}*\n\n⚠️ Domain *${domain}* tidak dapat ditemukan atau belum terdaftar di jaringan internet.` }, { quoted: m });
                }
                break;
            }

            case 'cekml':
            case 'mlcheck': {
                if (args.length < 2) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.cekml 1382068631 15679*' }, { quoted: m });
                    return;
                }
                const userId = args[0].replace(/[^0-9]/g, '');
                const zoneId = args[1].replace(/[^0-9]/g, '');

                await sock.sendMessage(sender, { text: `⏳ Sedang memeriksa data akun ML (ID: ${userId} (${zoneId}))...` }, { quoted: m });
                try {
                    const fetch = (await import('node-fetch')).default;
                    const response = await fetch(`https://api.betabotz.eu.org/api/game/ml?id=${encodeURIComponent(userId)}&zoneId=${encodeURIComponent(zoneId)}&apikey=beta-botz`);
                    const res = await response.json();
                    const data = res.result || res.data || res;
                    const username = data.username || data.name || data.nickname;

                    if (username) {
                        const mlText = `🎮 *MOBILE LEGENDS PLAYER STATS* 🎮\n\n` +
                                       `• *Username:* ${username}\n` +
                                       `• *User ID:* ${userId}\n` +
                                       `• *Server ID:* (${zoneId})\n\n` +
                                       `_Pemeriksaan profil berhasil dilakukan!_`;
                        await sock.sendMessage(sender, { text: mlText }, { quoted: m });
                    } else {
                        throw new Error('Data tidak ditemukan');
                    }
                } catch (e) {
                    const fallbackText = `🎮 *MOBILE LEGENDS CHECKER* 🎮\n\n` +
                                         `• *User ID:* ${userId}\n` +
                                         `• *Server ID:* (${zoneId})\n\n` +
                                         `🔗 *Cek Data Akun Instan:*\n` +
                                         `https://www.duniagames.co.id/top-up/item/mobile-legends?id=${userId}&zoneId=${zoneId}`;
                    await sock.sendMessage(sender, { text: fallbackText }, { quoted: m });
                }
                break;
            }

            case 'cekff':
            case 'ffcheck': {
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.cekff [Player ID]*\nContoh: *.cekff 123456789*' }, { quoted: m });
                    return;
                }
                const ffId = args[0].replace(/[^0-9]/g, '');
                await sock.sendMessage(sender, { text: `⏳ Sedang memeriksa data akun Free Fire (ID: ${ffId})...` }, { quoted: m });
                try {
                    const fetch = (await import('node-fetch')).default;
                    const response = await fetch(`https://api.siputzx.my.id/api/game/ff?id=${encodeURIComponent(ffId)}`);
                    const res = await response.json();
                    const data = res.data || res.result || res;
                    const nickname = data.username || data.name || data.nickname;

                    if (nickname) {
                        const ffText = `🔥 **FREE FIRE ACCOUNT CHECKER** 🔥\n\n` +
                                       `• *Nickname:* ${nickname}\n` +
                                       `• *Player ID:* ${ffId}\n\n` +
                                       `_Pemeriksaan akun Free Fire berhasil!_`;
                        await sock.sendMessage(sender, { text: ffText }, { quoted: m });
                    } else {
                        throw new Error('Data tidak ditemukan');
                    }
                } catch (e) {
                    const fallbackText = `🔥 **FREE FIRE ACCOUNT CHECKER** 🔥\n\n` +
                                         `• *Player ID:* ${ffId}\n\n` +
                                         `🔗 *Cek Akun & Nickname Resmi:*\n` +
                                         `https://www.duniagames.co.id/top-up/item/free-fire?id=${ffId}`;
                    await sock.sendMessage(sender, { text: fallbackText }, { quoted: m });
                }
                break;
            }

            case 'claim':
            case 'harian': {
                const todayClaim = getTodayDate();
                if (!global.userClaims) global.userClaims = {};
                if (global.userClaims[senderNumber] === todayClaim) {
                    await sock.sendMessage(sender, { text: '⚠️ Kamu sudah melakukan klaim hadiah harian hari ini! Coba lagi besok ya.' });
                } else {
                    global.userClaims[senderNumber] = todayClaim;
                    await sock.sendMessage(sender, { text: '🎉 **SELAMAT! KLAIM HARIAN BERHASIL** 🎉\n\n🎁 Kamu mendapatkan:\n• +5 Bonus Limit Command Tambahan!\n• 1x Tiket Spesial Bot\n\nSemoga harimu menyenangkan! ✨' });
                }
                break;
            }

            case 'slot': {
                const db = getUsersData();
                if (!db[senderNumber]) db[senderNumber] = { coins: 100, lastClaim: '' };
                const bet = parseInt(args[0]);
                if (isNaN(bet) || bet <= 0 || db[senderNumber].coins < bet) {
                    await sock.sendMessage(sender, { text: 'Contoh: .slot 20 (Pastikan koin cukup)' }, { quoted: m });
                    return;
                }
                db[senderNumber].coins -= bet;
                const emojis = ['🍇', '🍉', '🍊', '🍎', '🍒', '7️⃣'];
                const s1 = emojis[Math.floor(Math.random() * emojis.length)];
                const s2 = emojis[Math.floor(Math.random() * emojis.length)];
                const s3 = emojis[Math.floor(Math.random() * emojis.length)];
                let msg = `🎰 [ ${s1} : ${s2} : ${s3} ]\n`;
                if (s1 === s2 && s2 === s3) {
                    db[senderNumber].coins += bet * 5;
                    msg += '🎉 JACKPOT MENANG!';
                } else {
                    msg += '❌ Kamu Kalah!';
                }
                saveUsersData(db);
                await sock.sendMessage(sender, { text: `${msg}\n💰 Sisa Koin: ${db[senderNumber].coins}` }, { quoted: m });
                break;
            }

            case 'level':
            case 'rank': {
                const lvlDb = getUsersData();
                if (!lvlDb[senderNumber]) lvlDb[senderNumber] = { xp: 0, level: 1 };
                const uLvl = lvlDb[senderNumber];
                await sock.sendMessage(sender, { text: `📊 **LEVEL**\n👤 @${senderNumber}\n⭐ Level: *${uLvl.level || 1}*\n✨ XP: *${uLvl.xp || 0}*`, mentions: [sender] }, { quoted: m });
                break;
            }

            case 'leaderboard':
            case 'lb': {
                const lvlDb = getUsersData();
                const sorted = Object.entries(lvlDb).sort((a, b) => (b[1].level || 1) - (a[1].level || 1)).slice(0, 10);
                let text = `🏆 **LEADERBOARD LEVEL** 🏆\n\n`;
                let mentions = [];
                sorted.forEach(([num, data], i) => {
                    text += `${i + 1}. @${num} (Level: ${data.level || 1})\n`;
                    mentions.push(num + '@s.whatsapp.net');
                });
                await sock.sendMessage(sender, { text, mentions }, { quoted: m });
                break;
            }

            case 'menfess':
            case 'confess': {
                if (args.length < 3) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.menfess [nomor_tujuan] [pesan]*\nContoh: *.menfess 628123456789 Halo, ini pesan rahasia*' }, { quoted: m });
                    return;
                }
                const targetNumber = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                const pesanMenfess = args.slice(1).join(' ');

                await sock.sendMessage(targetNumber, { text: `💌 **PESAN MENFESS / RAHASIA**\n\nKamu menerima pesan rahasia dari seseorang:\n\n> "${pesanMenfess}"\n\n_Pesan ini dikirimkan melalui bot otomatis._` });
                await sock.sendMessage(sender, { text: '✅ Berhasil! Pesan menfess kamu sudah dikirim ke nomor tujuan.' }, { quoted: m });
                break;
            }

            case 'addprem':
                if (!isPro) {
                    await sock.sendMessage(sender, { text: '❌ Perintah ini khusus untuk Owner bot!' });
                    return;
                }
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.addprem 628123456789*' });
                    return;
                }
                const targetPrem = args[0].replace(/[^0-9]/g, '');
                let currentPrem = getPremiumUsers();
                if (!currentPrem.includes(targetPrem)) {
                    currentPrem.push(targetPrem);
                    savePremiumUsers(currentPrem);
                    await sock.sendMessage(sender, { text: `✅ Berhasil menambahkan nomor *${targetPrem}* ke daftar **PREMIUM USER**!` });
                } else {
                    await sock.sendMessage(sender, { text: `⚠️ Nomor *${targetPrem}* sudah terdaftar sebagai user premium sebelumnya.` });
                }
                break;

            case 'delprem':
                if (!isPro) {
                    await sock.sendMessage(sender, { text: '❌ Perintah ini khusus untuk Owner bot!' });
                    return;
                }
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.delprem 628123456789*' });
                    return;
                }
                const targetDel = args[0].replace(/[^0-9]/g, '');
                let listPrem = getPremiumUsers();
                const index = listPrem.indexOf(targetDel);
                if (index > -1) {
                    listPrem.splice(index, 1);
                    savePremiumUsers(listPrem);
                    await sock.sendMessage(sender, { text: `🗑️ Berhasil menghapus nomor *${targetDel}* dari daftar premium.` });
                } else {
                    await sock.sendMessage(sender, { text: `⚠️ Nomor *${targetDel}* tidak ditemukan di daftar premium.` });
                }
                break;

            case 'balas':
                if (isPro && args.length >= 2) {
                    await sock.sendMessage(args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net', { text: `💬 Pesan dari Owner: ${args.slice(1).join(' ')}` });
                    await sock.sendMessage(sender, { text: '✅ Pesan terkirim.' }, { quoted: m });
                }
                break;

            case 'katailmu':
            case 'bijak': {
                const kataBijakList = [
                    "Ilmu itu bukan yang dihafal, tapi yang memberi manfaat.",
                    "Kegagalan adalah bumbu yang memberikan rasa pada kesuksesan.",
                    "Jangan pernah menyerah pada impianmu hanya karena butuh waktu lama untuk mencapainya.",
                    "Waktu terbaik untuk memulai adalah kemarin, waktu terbaik kedua adalah sekarang."
                ];
                const randomBijak = kataBijakList[Math.floor(Math.random() * kataBijakList.length)];
                await sock.sendMessage(sender, { text: `💡 **KATA MUTIARA & ILMU**\n\n_"_${randomBijak}_"_\n\nSemoga menginspirasi harimu! ✨` });
                break;
            }

            case 'gombal':
            case 'rayuan': {
                const gombalList = [
                    "Kamu itu mirip seperti terminal Acode, bikin aku betah berlama-lama mandangin layar.",
                    "Sejak kenal kamu, aku nggak perlu lagi nulis rumus matematika buat nyari kepastian.",
                    "Kamu tahu nggak bedanya kamu sama error code? Kalau error bikin pusing, kalau kamu bikin tenang."
                ];
                const randomGombal = gombalList[Math.floor(Math.random() * gombalList.length)];
                await sock.sendMessage(sender, { text: `🤭 **RAYUAN MAUT**\n\n_${randomGombal}_` });
                break;
            }

            case 'panggilowner':
            case 'report':
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.panggilowner Botnya error saat pakai command tertentu*' });
                } else {
                    const laporan = args.join(' ');
                    const ownerJid = '6287852063799@s.whatsapp.net';
                    await sock.sendMessage(ownerJid, { text: `🚨 **LAPORAN MASUK DARI USER**\n\n👤 Pengirim: wa.me/${senderNumber}\n💬 Pesan: ${laporan}` });
                    await sock.sendMessage(sender, { text: '📩 Laporanmu sudah dikirim langsung ke Owner. Mohon tunggu respon selanjutnya ya!' });
                }
                break;

            case 'rules':
            case 'peraturan':
                await sock.sendMessage(sender, { text: 'PERATURAN BOT:\n1. Jangan spam command.\n2. Jangan telepon/video call bot.\n3. Gunakan dengan bijak dan bertanggung jawab.' });
                break;

            case 'server':
                await sock.sendMessage(sender, { text: 'Info Server:\nOS: Alpine Linux (Acode Environment)\nLibrary: Baileys MD\nStatus: Online 24/7' });
                break;

            case 'qt':
            case 'quote':
                await sock.sendMessage(sender, { text: '"Jangan batasi tantangannya, tapi tantang batasanmu untuk terus maju!"' });
                break;

            case 'salam':
                await sock.sendMessage(sender, { text: 'Assalamualaikum warahmatullahi wabarakatuh! Salam hangat untuk semuanya.' });
                break;

            case 'pantun': {
                const pList = ["Ikan hiu makan kedondong,\nWayooo, lanjut sendiri dong! 😂", "Buah mangga buah durian,\nEnggak nyangka kita temenan. 🌴"];
                await sock.sendMessage(sender, { text: `📜 **PANTUN**\n\n${pList[Math.floor(Math.random() * pList.length)]}` });
                break;
            }

            case 'tebak': {
                const listTebak = [
                    { soal: "Hewan apa yang taat lalu lintas?", jawab: "kambing hitam" },
                    { soal: "Gajah apa yang belalainya pendek?", jawab: "gajah pesek" },
                    { soal: "Kucing apa yang paling romantis?", jawab: "kucing cintaku" },
                    { soal: "Benda apa yang kalau ditarik malah makin pendek?", jawab: "celana pendek" },
                    { soal: "Kenapa lampu matikan warna merah?", jawab: "kalau hijau jalan" },
                    { soal: "Monyet apa yang paling besar?", jawab: "monyet sawah" },
                    { soal: "Ayam apa yang bikin berantem?", jawab: "ayam betutu" },
                    { soal: "Sandi apa yang bisa bikin seger?", jawab: "sandiwara" },
                    { soal: "Kota apa yang banyak bapak-bapaknya?", jawab: "purwokerto" },
                    { soal: "Buah apa yang kalau dimakan bikin merinding?", jawab: "buah mangga durian runtuh" },
                    { soal: "Kutu apa yang paling mengerikan?", jawab: "kutukan" },
                    { soal: "Tuliskan nama bulan yang punya 28 hari?", jawab: "semua bulan" },
                    { soal: "Kenapa air laut asin?", jawab: "karena ikannya pada berkeringat" },
                    { soal: "Bank apa yang sering bikin kesal?", jawab: "bank-rut" },
                    { soal: "Nasi apa yang tidak pernah basi?", jawab: "nasihat" },
                    { soal: "Mangkok apa yang bisa pecah jadi seribu?", jawab: "mangkok pecah" }
                ];
                const r = listTebak[Math.floor(Math.random() * listTebak.length)];
                global.activeTebak[sender] = { answer: r.jawab };
                await sock.sendMessage(sender, { text: `🧩 **GAME TEBAK-TEBAKAN**\n\nSoal: *${r.soal}*\n\nSilakan ketik jawabannya langsung di chat ini!` }, { quoted: m });
                break;
            }

            case 'fakta':
                await sock.sendMessage(sender, { text: 'Fakta Unik: Madu adalah satu-satunya makanan alami di dunia yang tidak akan pernah basi atau kedaluwarsa.' });
                break;

            case 'lirik':
                await sock.sendMessage(sender, { text: '"Walk through the fire, out through the flames..." (Lirik penyemangat untuk menemani aktivitas kita hari ini!)' });
                break;

            case 'khodam':
                await sock.sendMessage(sender, { text: 'Hasil Cek Khodam Anda:\n🔮 Khodam: **Kabel Terminal Acode V2**\nEnergi: Sangat kuat mendeteksi error sintaks!' });
                break;

            case 'cuaca':
            case 'weather':
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.cuaca Jakarta* atau *.cuaca Nganjuk*' });
                } else {
                    const city = args.join(' ');
                    try {
                        const fetch = (await import('node-fetch')).default;
                        const response = await fetch(`https://api.siputzx.my.id/api/tools/cuaca?city=${encodeURIComponent(city)}`);
                        const res = await response.json();
                        if (res && (res.status || res.suhu || res.temperature)) {
                            const info = res.data || res;
                            const textCuaca = `🌤️ **INFO CUACA: ${city.toUpperCase()}**\n\n` +
                                              `🌡️ Suhu: ${info.temperature || info.suhu || '28°C'}\n` +
                                              `☁️ Kondisi: ${info.weather || info.kondisi || 'Cerah Berawan'}\n` +
                                              `💧 Kelembapan: ${info.humidity || info.kelembapan || '75%'}\n\n` +
                                              `*Tetap jaga kesehatan ya!* ✨`;
                            await sock.sendMessage(sender, { text: textCuaca });
                        } else {
                            throw new Error('Data tidak valid');
                        }
                    } catch (e) {
                        await sock.sendMessage(sender, { text: `🌤️ **INFO CUACA: ${city.toUpperCase()}**\n\n🌡️ Suhu: 29°C\n☁️ Kondisi: Berawan Sejuk\n💧 Kelembapan: 70%\n\n*(Mode Simulasi / Offline)* ✨` });
                    }
                }
                break;

            case 'quran':
            case 'alquran':
                if (args.length === 0) {
                    await sock.sendMessage(sender, { text: 'Contoh penggunaan: *.quran 1* (Al-Fatihah) atau *.quran 36* (Yasin)' });
                } else {
                    const surahNum = args[0];
                    try {
                        const fetch = (await import('node-fetch')).default;
                        const response = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/id.indonesian`);
                        const res = await response.json();
                        if (res && res.code === 200 && res.data) {
                            const s = res.data;
                            const textQuran = `📖 **SURAH ${s.englishName.toUpperCase()} (${s.name})**\n` +
                                              `💬 Arti: ${s.englishNameTranslation}\n` +
                                              `📊 Jumlah Ayat: ${s.numberOfAyahs} Ayat\n` +
                                              `📍 Jenis: ${s.revelationType === 'Meccan' ? 'Makkiyah' : 'Madaniyah'}\n\n` +
                                              `*Ayat 1:* ${s.ayahs ? s.ayahs[0].text : 'Tersedia di Al-Quran'}\n\n` +
                                              `*Semoga membawa berkah.* ✨`;
                            await sock.sendMessage(sender, { text: textQuran });
                        } else {
                            throw new Error('Surah tidak ditemukan');
                        }
                    } catch (e) {
                        const listSurah = {
                            "1": { name: "Al-Fatihah", arti: "Pembukaan", ayat: "7", desc: "Dengan nama Allah Yang Maha Pengasih, Maha Penyayang." },
                            "2": { name: "Al-Baqarah", arti: "Sapi Betina", ayat: "286", desc: "Alif Lam Mim. Kitab ini tidak ada keraguan padanya, petunjuk bagi mereka yang bertakwa." },
                            "36": { name: "Ya Sin", arti: "Ya Sin", ayat: "83", desc: "Yasin. Demi Al-Quran yang penuh hikmah." }
                        };
                        const sData = listSurah[surahNum] || { name: `Surah ke-${surahNum}`, arti: "Pilihan", ayat: "-", desc: "Bacaan Al-Quran penyejuk hati." };
                        await sock.sendMessage(sender, { text: `📖 **SURAH ${sData.name.toUpperCase()}**\n` +
                                                          `💬 Arti: ${sData.arti}\n` +
                                                          `📊 Jumlah Ayat: ${sData.ayat} Ayat\n\n` +
                                                          `*Terjemahan:* ${sData.desc}\n\n` +
                                                          `*(Mode Simulasi / Offline)* ✨` });
                    }
                }
                break;

            case 'rate':
                await sock.sendMessage(sender, { text: 'Hasil Rate:\nTingkat Keren: 99%\nTingkat Semangat: 100%\nStatus: Mantap jiwa!' });
                break;

            case 'galau':
                await sock.sendMessage(sender, { text: 'Kata Galau Hari Ini:\n"Lebih baik lelah karena berusaha mengejar impian daripada lelah memikirkan hal yang tak pasti."' });
                break;

            case 'motivasi':
                await sock.sendMessage(sender, { text: 'Motivasi:\n"Kesalahan (error) di dalam proses bukanlah akhir segalanya, melainkan petunjuk jalan menuju kesuksesan."' });
                break;

            case 'asmaulhusna':
                await sock.sendMessage(sender, { text: 'Ar-Rahman (Maha Pengasih) & Ar-Rahiim (Maha Penyayang). Semoga hari ini penuh keberkahan untuk kita semua.' });
                break;

            case 'doa':
                await sock.sendMessage(sender, { text: 'Doa Harian:\n"Rabbana atina fid-dunya hasanah wa fil-akhirati hasanah wa qina \'adzaban-nar."' });
                break;

            case 'hadits':
                await sock.sendMessage(sender, { text: 'Mutiara Hadits:\n"Sebaik-baik manusia adalah yang paling bermanfaat bagi orang lain." (HR. Ahmad)' });
                break;

            case 'donasi':
            case 'donate':
                await sock.sendMessage(sender, { text: '💖 **Dukung Perkembangan Bot**\nTerima kasih banyak sudah menggunakan bot ini! Jika ingin mendukung secara finansial agar bot terus aktif, kamu bisa berdonasi melalui Saweria:\n\n🔗 https://saweria.co/All36\n\nBerapapun dukunganmu sangat berarti bagi kami!' });
                break;

            case 'feedback':
            case 'saran':
                await sock.sendMessage(sender, { text: 'Masukan atau laporan error Anda akan otomatis dicatat dan diperiksa oleh pengembang.' });
                break;

            case 'tips':
                await sock.sendMessage(sender, { text: 'Tips Acode: Selalu pastikan file tersimpan (ikon disket hijau) sebelum merestart bot di terminal.' });
                break;

            default:
                if (isCmd) {
                    await sock.sendMessage(sender, { text: `❌ Command .${command} tidak ditemukan. Ketik .menu untuk melihat daftar command yang tersedia!` }, { quoted: m });
                }
                break;
        }
    });

    if (!sock.authState.creds.registered) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const phoneNumber = await question('Masukkan nomor WhatsApp Anda (cth: 628xxxxxxxxxx): ');
        let code = await sock.requestPairingCode(phoneNumber.trim());
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log(`Kode Pairing WhatsApp Actions: ${code}`);
    }

    sock.ev.on('creds.update', saveCreds);
}

startBot();
