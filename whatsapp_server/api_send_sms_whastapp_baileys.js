const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestWaWebVersion,
    downloadContentFromMessage   // ✅ NEW
} = require('@whiskeysockets/baileys');

const QRCode = require('qrcode');
const qrcode = require('qrcode-terminal')
const P = require('pino');
const path = require('path');
const fs = require('fs'); // Para guardar logs en archivo
const Papa = require('papaparse');
const axios = require('axios'); 
const ffmpeg = require('fluent-ffmpeg');  

const { createClient } = require('redis');

const redisClient = createClient({
  url: 'redis://localhost:6379'
});

redisClient.on('error', err => console.error('Redis error', err));



// connect safely (no top-level await)
// ✅ wrap in async function
async function initRedis() {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error(' Redis connection error:', err);
  }
}

initRedis();

//CARPETA PARA TEMPORALES
process.env.TMPDIR = path.join(__dirname, 'temp');
process.env.TEMP = path.join(__dirname, 'temp');
process.env.TMP = path.join(__dirname, 'temp');

const app = express();
app.use(express.json()); // Para parsear JSON

 

 
async function cleanLLMSpam(session_id, text) {
  try {
    text = String(text || '').replace(/\s+/g, ' ').trim();

    const sentences = text.split(/(?<=[\.\?\!])\s+/);

    const key = `chat:${session_id}`;
    const history = await redisClient.lRange(key, -5, -1);

    const previousSentences = new Map(); // normalized -> count

    // 🔹 Load Redis history
    for (const item of history) {
      try {
        const msg = JSON.parse(item);

        if (msg.role === "assistant" && msg.content) {
          const count = msg.count || 0;

          const split = msg.content.split(/(?<=[\.\?\!])\s+/);

          for (let s of split) {
            const norm = normalizeText(s);
            if (norm) {
              previousSentences.set(
                norm,
                Math.max(previousSentences.get(norm) || 0, count)
              );
            }
          }
        }
      } catch {}
    }

    const seen = [];
    const result = [];

    for (let sentence of sentences) {
      const cleaned = sentence.trim();
      const normalized = normalizeText(cleaned);

      if (!normalized) continue;

      const previousCount = previousSentences.get(normalized) || 0;

      // Check similarity against already accepted sentences
      const isDuplicateLocal = seen.some(s => isSimilar(s, normalized));

      // Check similarity against Redis history
      const isDuplicateHistory = [...previousSentences.keys()]
        .some(prev => isSimilar(prev, normalized));

      if (
        !isDuplicateLocal &&
        !isDuplicateHistory &&
        previousCount <= 1
      ) {
        seen.push(normalized);
        result.push(cleaned);
      }
    }

    const finalText = result.join(' ').trim();

    return finalText || text;

  } catch (err) {
    console.error("cleanLLMSpam error:", err);
    return String(text || '');
  }
}

function formatDateToYYYYMMDD(date) {
  const d = (date instanceof Date) ? date : new Date(date);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}


//////////////////////////////////////////////////////
// ✅ AUDIO SAVE FUNCTION
//////////////////////////////////////////////////////
async function saveAudioMessage(audioMessage, msgId) {
    try {
        const audioDir = path.join(ellstackDir, 'data', 'audio');

        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
        }

        const stream = await downloadContentFromMessage(audioMessage, 'audio');

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const tempOgg = path.join(audioDir, `${msgId}.ogg`);
        const finalMp3 = path.join(audioDir, `${msgId}.mp3`);

        fs.writeFileSync(tempOgg, buffer);

        await new Promise((resolve, reject) => {
            ffmpeg(tempOgg)
                .toFormat('mp3')
                .on('end', () => {
                    fs.unlinkSync(tempOgg);
                    resolve();
                })
                .on('error', reject)
                .save(finalMp3);
        });

        return finalMp3;

    } catch (err) {
        console.error("Error saving audio:", err);
        return null;
    }
}



// Open database (it will create it if it doesn't exist)

const ellstackDir = process.env.ELLSTACK_DIR; // fallback if not set

const dbPath = path.join(ellstackDir, 'data', 'ellsdb');


const ffmpegPath = path.join(
  process.env.ELLSTACK_DIR,
  'decoder_audio',
  'bin',
  'ffmpeg.exe'
);

ffmpeg.setFfmpegPath(ffmpegPath);


let sock;
const MAX_RETRIES = 3; // Máximo número de intentos de reenvío

async function startWhatsApp() {
    try {

        const { version, isLatest } = await fetchLatestWaWebVersion();
         console.log(`using WA v${version.join(".")}, isLatest: ${isLatest}`);

        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        sock = makeWASocket({
            version, // Use the fetched version
            auth: state,
            logger: P({ level: 'silent' }),
            printQRInTerminal: false, // No imprime el QR en la terminal
            connectTimeoutMs: 60_000 // Aumenta el tiempo de espera a 60 segundos
        });

        sock.ev.on('creds.update', saveCreds);
  
// Reenviar mensajes entrantes a un webhook

let WEBHOOK_URL = '';

let enviarRecibidos = true;    // Control para mensajes recibidos
let enviarEnviados = true;    // Control para+ mensajes enviados
let enviarGrupos = false;      // Control para mensajes que vienen de grupos


async function transcribeAudio(filePath) {
    try {
        const response = await axios.post('http://localhost:8964/transcribe', {
            path: filePath
        });

        return response.data.text || "";
    } catch (err) {
        console.error("Transcription error:", err.message);
        return "";
    }
}

sock.ev.on('messages.upsert', async ({ messages, type }) => {
  if (type !== 'notify') return;

  for (const msg of messages) {
    try {
      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      const sender = msg.key.participant || msg.key.remoteJid;


     

      //ignorar mensajes de estados y otros
      if (msg.key.remoteJid === 'status@broadcast' || msg.key.id?.startsWith('BAE5') || msg.message?.protocolMessage) continue;

      // Control para mensajes de grupos
      if (isGroup && !enviarGrupos) continue;

      // Control según mensaje enviado o recibido
      if (msg.key.fromMe && !enviarEnviados) continue;
      if (!msg.key.fromMe && !enviarRecibidos) continue;

      let text = '';

      if (msg.key.fromMe) 
          {
            WEBHOOK_URL = "http://localhost:8082/wsxwhenv";
          }  
            else 
              WEBHOOK_URL = "http://localhost:8082/wsxwh";   

  
      // Detectar si es audio
      if (msg.message?.audioMessage) {
           const msgId = msg.key.id;

                        const audioPath = await saveAudioMessage(
                            msg.message.audioMessage,
                            msgId
                        );

                        let transcribedText = '';

                        if (audioPath) {
                            transcribedText = await transcribeAudio(audioPath);
                        }
                        
                        if (!transcribedText || transcribedText.trim() === '') {
                           transcribedText = '[Audio without transcribe]';
}
 

                        await axios.post(WEBHOOK_URL, {
                            from: sender.split('@')[0],
                            name: '',
                            message: transcribedText,
                            audio_path: audioPath,
                            to: sock.user.id.split(':')[0]
                        });

                       
                        continue;
      }
      // Detectar texto plano
      else if (msg.message?.conversation) {
        text = msg.message.conversation;
      }
      // Detectar texto extendido
      else if (msg.message?.extendedTextMessage?.text) {
        text = msg.message.extendedTextMessage.text;
      }
      else {
        continue; // Ignorar otros tipos
      }

   
    // Obtener nombre del remitente si existe
      const contacto = await sock.onWhatsApp(sender.split('@')[0]);
      const profileName = contacto?.[0]?.notify || 'Desconocido';      

    

      // Enviar al webhook
      await axios.post(WEBHOOK_URL, {
        from: sender.split('@')[0],     // Número sin @s.whatsapp.net
        name: profileName,              // Nombre del perfil si se pudo obtener
        message: text,
        to : sock.user.id.split(':')[0]
      });

      
    } catch (err) {
      console.error('Error al reenviar mensaje al webhook:', err);
    }
  }
});


        // Maneja eventos de conexión
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                    console.log('📲 Escanea este QR con WhatsApp:')
                    qrcode.generate(qr, { small: true }) // ✅ QR legible en consola
                  }
            

            if (connection === 'close') {
                const error = lastDisconnect?.error;

                // Verifica si el error es Connection Failure con el código 401
                if (error?.output?.statusCode === 401 && error?.data?.reason === '401') {
                    console.log('Connection Failure detected, restarting authentication...');

                    // Elimina las credenciales existentes para forzar la solicitud de un nuevo QR
                    fs.rmSync('auth_info', { recursive: true, force: true });

                    // Reinicia el proceso de WhatsApp
                    await startWhatsApp();
                } else {
                    const shouldReconnect = (error?.output?.statusCode !== DisconnectReason.loggedOut);
                    console.log('Connection closed due to', error, ', reconnecting:', shouldReconnect);
                    if (shouldReconnect) {
                        await startWhatsApp();
                    } else {
                        console.log('Not reconnecting, reason: logged out');
                    }
                }
            } else if (connection === 'open') {
                console.log('Connection opened');
            } else if (qr) {
                // Genera un nuevo QR y lo guarda como imagen
                QRCode.toFile('qr-code-webhook.png', qr, {
                    color: {
                        dark: '#000000', // Color del QR
                        light: '#ffffff' // Fondo del QR
                    }
                }, (err) => {
                    if (err) throw err;
                    console.log('QR code image saved as qr-code.png');
                });
            }
        });


        // Espera a que la conexión esté abierta
        await new Promise((resolve) => {
            sock.ev.on('connection.update', (update) => {
                const { connection } = update;
                if (connection === 'open') resolve();
            });
        });
    } catch (error) {
        logError('Failed to start WhatsApp connection:', error);
    }
}

startWhatsApp();

app.post('/send-message', async (req, res) => {
    var { number, message, imageUrl, isgroup, borrar } = req.body;

    if (!number || !message) {
        return res.status(400).send('Número y mensaje son obligatorios');
    }

    // Verifica que la conexión esté abierta
    if (!sock) {
        return res.status(500).send('Conexión de WhatsApp no establecida');
    }

    try {
        var adic = isgroup ? "@g.us" : "@s.whatsapp.net";
        let messageOptions = {};

        if ((adic == "@s.whatsapp.net" ) && (number.length > 12))
           {
             adic = '@lid';
             


           }   
 

            
       

        if (imageUrl) {
            //const extension = path.extname(imageUrl);
            const extension = '';

            if (extension === ".pdf") {
                messageOptions = {
                    document: { url: imageUrl },
                    mimetype: 'application/pdf',
                    fileName: message,
                    caption: message,
                    mimetype: 'image/jpeg'
 
                };
            } else {

                    messageOptions = {
                    image: { url: imageUrl },
                    caption: message
                    };  
                    
                if (borrar) {
                    messageOptions.viewOnce = true;
                }


            }
        } else {
            messageOptions = { text: message };
        }

       
        await sendMessageWithRetries(`${number + adic}`, messageOptions, MAX_RETRIES);

        if (imageUrl) {
            res.status(200).send('Message with image sent successfully');
        } else {
            res.status(200).send('Text message sent successfully');
        }
    } catch (error) {
        logError('Failed to send message after retries:', error);
        res.status(500).send('Failed to send message');
    }
});


//APP Get para extraer grupos Ejemplo: de uso http://localhost:8082/get-groups


app.get('/get-groups', async (req, res) => {
    try {
        if (!sock) {
            return res.status(500).send('Conexión de WhatsApp no establecida');
        }

        // Obtiene todos los grupos
        const groups = await sock.groupFetchAllParticipating();

        // Obtener mi número de WhatsApp
        const myNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Procesar la información de los grupos
        const groupDetails = Object.values(groups).map((group) => {
            const participants = group.participants || [];

            // Buscar si mi número es admin en este grupo
            const myRole = participants.find(p => p.id === myNumber)?.admin;
            const isAdmin = myRole === 'admin' || myRole === 'superadmin';

            return {
                ID: group.id,
                Name: group.subject,
                Admin: isAdmin ? 'Sí' : 'No'
            };
        });

        // Convertir datos a CSV con formato correcto
        const csvData = Papa.unparse(groupDetails, {
            delimiter: ",",  // Usa coma como separador de columnas
            header: true     // Incluye encabezados en el CSV
        });

        // Guardar en un archivo CSV
        fs.writeFileSync('groups.csv', csvData, 'utf8');

        res.status(200).json({ message: 'Detalles de grupos guardados en CSV', groups: groupDetails });

    } catch (error) {
        console.error('Failed to fetch groups:', error);
        res.status(500).send('Failed to fetch groups');
    }
});



//APP Post para agregar un numero a todos los grupos

app.post('/add-to-all-groups', async (req, res) => {
    const { number } = req.body;

    if (!number) {
        return res.status(400).send('Número es obligatorio');
    }

    try {
        if (!sock) {
            return res.status(500).send('Conexión de WhatsApp no establecida');
        }

        const groups = await sock.groupFetchAllParticipating();
        const groupIds = Object.keys(groups); // Obtener IDs de los grupos

        const results = [];

        for (const groupId of groupIds) {
            try {
                const result = await sock.groupParticipantsUpdate(
                    groupId, // ID del grupo
                    [`${number}@s.whatsapp.net`], // Número a agregar
                    'add' // Acción: 'add' para agregar
                );
                results.push({ groupId, status: 'success', result });

                // Espera 2 minutos antes de agregar al siguiente grupo
                await new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000));
            } catch (error) {
                console.error(`Error agregando al grupo ${groupId}:`, error);
                results.push({ groupId, status: 'error', error: error.message });
            }
        }

        res.status(200).json({
            message: 'Intentos de agregar número realizados',
            results,
        });
    } catch (error) {
        logError('Error al agregar número a los grupos:', error);
        res.status(500).send('Error al agregar número a los grupos');
    }
});



// Función para intentar enviar un mensaje con reintentos automáticos
async function sendMessageWithRetries(receiver, messageOptions, maxRetries) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            attempt++;
            // Intenta enviar el mensaje
            await Promise.race([
                sock.sendMessage(receiver, messageOptions),
                timeout(30000)
            ]);
            console.log(`Message sent on attempt ${attempt}`);
            break; // Si se envía correctamente, sale del bucle
        } catch (error) {
            if (attempt >= maxRetries) {
                logError(`Failed after ${maxRetries} attempts`, error);
                throw new Error('Max retries reached');
            }
            console.log(`Attempt ${attempt} failed, retrying...`);
        }
    }
}

// Función para manejar timeout
function timeout(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
}

// Función para guardar errores en archivo
function logError(message, error) {
    const now = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const logMessage = `${now} - ${message} ${error.stack || error}\n`;
    fs.appendFileSync('error.log', logMessage);
    console.error(message, error);
}


// Manejo global de promesas rechazadas no manejadas
process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled Rejection at:', reason);
});


async function whatsappsend(telefono,mensaje,grupo,puerto,imagen) {

const Database = require('better-sqlite3');


const db = new Database(dbPath);

 
    // Get all pending messages
    const pendingMessages = db.prepare(`
        SELECT param_value FROM local_setting WHERE param='TRAINING_MODE' LIMIT 1
    `).all();

    for (const PO of pendingMessages) {

           if (PO.param_value === 'ON')
              return "Training mode";
            
        }        
      

// Prepare insert statement
const insert = db.prepare(`
    INSERT INTO whatsapp_message_queue
    (to_phone, message, is_group, from_phone, status, image)
    VALUES (?, ?, ?, ?, ?, ?)
`);

// Convert boolean group to integer (SQLite uses 0/1)
const isGroupValue = grupo ? 1 : 0;

// Execute insert
insert.run(
    telefono,
    mensaje,
    isGroupValue,
    puerto,
    'Pending',
    imagen || null
);
 db.close();
  

};  


async function ai_send(from_phone,from_id,mensaje,to_phone) {

const Database = require('better-sqlite3');


const db = new Database(dbPath);


    var dateMsg = new Date();
    var receiveDate = formatDateToYYYYMMDD(dateMsg.toLocaleString('en-US', {
      timeZone: 'America/Santo_Domingo'
    }));

 

    const existingRecord = db.prepare(`
      SELECT id FROM ai_message_queue
      WHERE from_phone = ? and status  = 'Pending'
      LIMIT 1
    `).get(from_phone);

    

    if (existingRecord) {
      // Record found — use to_phone directly
      console.log(`ai message record found for ${from_phone}, updating directly.`);
     
      const  insert = db.prepare(`
        update ai_message_queue set message = COALESCE(message, '') || '. ' ||  ?,
        updatedAt = ?,from_id = ?
        where from_phone = ? and status  = 'Pending'
    `);

      insert.run(
      mensaje,
      receiveDate,
      from_id,
      from_phone,
      );
    
    }
    else 
        {

        // Prepare insert statement
        const insert = db.prepare(`
            INSERT INTO ai_message_queue
            (from_phone,from_id, message,to_phone,createdAt,status)
            VALUES (?, ?, ?, ?, ?,?)
        `);

        
        // Execute insert
        insert.run(
            from_phone,
            from_id,
            mensaje,
            to_phone,
            receiveDate,
            'Pending' 
        ); 

        }
    
 

// Execute insert

 db.close();
  

};  



/* ==============================
   Webhook Endpoint
============================== */

app.post("/wsxwh", async function (req, rs) {

const bodyParser = require("body-parser");
const Database = require("better-sqlite3");

 
app.use(bodyParser.json());

/* ==============================
   SQLite Connection (High Performance)
============================== */

const db = new Database(dbPath, {
  //verbose: console.log
});

// Crear tabla si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_Inbound_message_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receive_date TEXT,
    message TEXT,
    from_phone TEXT,
    to_phone TEXT,
    status TEXT
  );

 
`);

// Prepared statement (más rápido)
const insertMessageStmt = db.prepare(`
  INSERT INTO whatsapp_Inbound_message_queue
  (receive_date, message, from_phone, to_phone, status,in_audio_path)
  VALUES (?, ?, ?, ?, ?,?)
`);


  try {

    const bodyData = req.body;

    
    /* ==============================
       Variables
    ============================== */

    var cell_phone = req.body.from;
    var email = cell_phone + '@nomail.com';
    var to_phone = req.body.to;
    var mensaje = req.body.message;
    var audio_path = ''

    if (req.body.audio_path)
       audio_path = req.body.audio_path
       

    var sesion = '3h43n34242n3423SFxA3@!KAFA0322l232%';
    var usuario_prov = '';
    var agente = '';
    var channel_actualizado = 'Whatsapp';
    var nombre = cell_phone;
    var apellido = '';
    var tipo_prospecto = 'C';

    /* ==============================
       Fechas
    ============================== */

    var startDate = new Date();
    var endDate = new Date();

    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(4, 0, 0, 0);

    endDate.setDate(endDate.getDate() + 3);
    endDate.setHours(4, 59, 0, 0);

    

   
    var dateMsg = new Date();
    var receiveDate = formatDateToYYYYMMDD(dateMsg.toLocaleString('en-US', {
      timeZone: 'America/Santo_Domingo'
    }));

    const result = insertMessageStmt.run(
      receiveDate,
      mensaje,
      cell_phone,
      to_phone,
      'Pending',
      audio_path
    );

    const mensajeGuardadoId = result.lastInsertRowid;


    

     
   

  

    /* ==============================
       Response
    ============================== */
   
    //enviar a cola de proceso para la IA 
    ai_send(cell_phone,mensajeGuardadoId,mensaje,to_phone) 

    rs.json({
      success: true,
      messageId: mensajeGuardadoId
    });

  } catch (error) {

    console.error("Error in /wsxwh:", error);

    rs.status(500).json({
      success: false,
      error: error.message
    });

  }




});

app.post("/wsxwhenv", async function (req, rs) {

const bodyParser = require("body-parser");
const Database = require("better-sqlite3");

 
app.use(bodyParser.json());

/* ==============================
   SQLite Connection (High Performance)
============================== */

const db = new Database(dbPath, {
  //verbose: console.log
});

// Crear tabla si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_Outbound_message_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receive_date TEXT,
    message TEXT,
    from_phone TEXT,
    to_phone TEXT,
    status TEXT
  );

 
`);

// Prepared statement (más rápido)
const insertMessageStmt = db.prepare(`
  INSERT INTO whatsapp_Outbound_message_queue
  (receive_date, message, from_phone, to_phone, status,audio_path,auto_match_phone)
  VALUES (?, ?, ?, ?, ?,?,?)
`);


const updateMessageStmt = db.prepare(`
update whatsapp_Inbound_message_queue  
set human_respond  =  COALESCE(human_respond, '') || ' ; ' ||  ?,training_status = ?,
out_audio_path = ?,auto_match_phone_response = ?
where id = (select max(id) from whatsapp_Inbound_message_queue w2
where  w2.from_phone = ?)

`);

//buscar si esta en entrenamiento

let agent_training = '';

const row = db.prepare(`
    SELECT param_value 
    FROM local_setting 
    WHERE param = 'TRAINING_MODE'
    LIMIT 1
`).get();

if (row?.param_value === 'ON') {
   agent_training = 'Pending';
}


  try {

    const bodyData = req.body;

    
    /* ==============================
       Variables
    ============================== */

    var cell_phone = req.body.to;
    var email = cell_phone + '@nomail.com';
    var to_phone =  req.body.from;
    var mensaje = req.body.message;

    var sesion = '3h43n34242n3423SFxA3@!KAFA0322l232%';
    var usuario_prov = '';
    var agente = '';
    var channel_actualizado = 'Whatsapp';
    var nombre = cell_phone;
    var apellido = '';
    var tipo_prospecto = 'C';

    var audio_path = ''

    if (req.body.audio_path)
       audio_path = req.body.audio_path
       

    /* ==============================
       Fechas
    ============================== */

    var startDate = new Date();
    var endDate = new Date();

    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(4, 0, 0, 0);

    endDate.setDate(endDate.getDate() + 3);
    endDate.setHours(4, 59, 0, 0);

    

   
    var dateMsg = new Date();
    var receiveDate = formatDateToYYYYMMDD(dateMsg.toLocaleString('en-US', {
      timeZone: 'America/Santo_Domingo'
    }));



    /* Check if a record exists in whatsapp_Inbound_message_queue for this phone */

    var mensajeGuardadoId = '';

    const existingRecord = db.prepare(`
      SELECT id FROM whatsapp_Inbound_message_queue
      WHERE from_phone = ?
      LIMIT 1
    `).get(to_phone);

    

    if (existingRecord) {
      
      const result = insertMessageStmt.run(
      receiveDate,
      mensaje,
      cell_phone,
      to_phone,
      'Completed',
      audio_path,
      ''
    );

     mensajeGuardadoId = result.lastInsertRowid;

      updateMessageStmt.run(
        mensaje,
        agent_training,
        audio_path,
        '',
        to_phone
      );
    } 
    else 
      {
      
      try {
      
            const matcherDate = formatDateToYYYYMMDD(
              new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' })
            );

            const matcherResponse = await axios.post('http://localhost:8964/phone_ai_matcher', {
              phone_number: to_phone,
              date_send: matcherDate
            });

            const matchPhone = matcherResponse.data?.match_phone;



            if (matchPhone) 
               {
                    const result = insertMessageStmt.run(
                    receiveDate,
                    mensaje,
                    cell_phone,
                    to_phone,
                    'Completed',
                    audio_path,
                     matchPhone
                    );
                

                    updateMessageStmt.run(
                    mensaje,
                    agent_training,
                    audio_path,
                    to_phone,
                    matchPhone
                  );

                  mensajeGuardadoId = result.lastInsertRowid;

               } 
                    
              else {

                    const result = insertMessageStmt.run(
                    receiveDate,
                    mensaje,
                    cell_phone,
                    to_phone,
                    'Completed',
                    audio_path,
                    ''
                    );

                    mensajeGuardadoId = result.lastInsertRowid;

                   }
          } 
      
      catch (matcherError) {
            console.error('Error calling phone_ai_matcher:', matcherError.message);
            // Fall through with original to_phone
      }

      
    }

    /* ==============================
       Response
    ============================== */

    rs.json({
      success: true,
      messageId: mensajeGuardadoId
    });

  } catch (error) {

    console.error("Error in /wsxwhenv:", error);

    rs.status(500).json({
      success: false,
      error: error.message
    });

  }

});

function normalizeText(text) {
  return String(text || '')
    .normalize('NFKD')                 // remove accents
    .replace(/[\u0300-\u036f]/g, '')   // remove diacritics
    .toLowerCase()
    .replace(/[^\w\s]/g, '')           // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function isSimilar(a, b) {
  if (!a || !b) return false;

  // Exact match
  if (a === b) return true;

  // Partial overlap (substring)
  if (a.includes(b) || b.includes(a)) return true;

  // Token similarity (Jaccard-like)
  const aWords = new Set(a.split(' '));
  const bWords = new Set(b.split(' '));

  let intersection = 0;
  for (let w of aWords) {
    if (bWords.has(w)) intersection++;
  }

  const similarity = intersection / Math.max(aWords.size, bWords.size);

  return similarity > 0.8; // tweak threshold if needed
}

const CHAT_LIMIT = 20; // same as your Python constant

async function getChatHistory(sessionId) {
  const key = `chat:${sessionId}`;

  const data = await redisClient.lRange(key, -CHAT_LIMIT, -1);

  return data
    .map(m => {
      try {
        return JSON.parse(m);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
} 


async function getMessageCount(sessionId, role, content) {
  const key = `chat:${sessionId}`;
  const normalizedTarget = normalizeText(content);

  try {
    // Leer últimos mensajes (optimizado)
    const messages = await redisClient.lRange(key, -20, -1);

    // Buscar desde el más reciente al más antiguo
    for (let i = messages.length - 1; i >= 0; i--) {
      try {
        const msg = JSON.parse(messages[i]);

        if (!msg || msg.role !== role) continue;

        if (normalizeText(msg.content) === normalizedTarget) {
          return msg.count || 0;
        }

      } catch (err) {
         

        continue;
      }
    }

    return 0;

  } catch (err) {
    console.error("Error getting message count:", err);
    return 0;
  }
}
 

app.post("/aibres", async function (req, rs) {

  
  const axios = require('axios');
  const Database = require('better-sqlite3');

  // Open SQLite database
  const db = new Database(dbPath);

  let respond = '';

 

  // Current timestamp
  const dateObj = new Date();
  const sentToAiTime = formatDateToYYYYMMDD(dateObj.toLocaleString('en-US', { 
    timeZone: 'America/Santo_Domingo' 
  }));

  // ===============================
  // 1️⃣ GET CURRENT RECORD
  // ===============================
  const getStmt = db.prepare(`
    SELECT * 
    FROM ai_message_queue 
    WHERE status in ('Pending','Sent to AI','AI RESPOND ERROR RETRY') 
    order by id 
  `);

  
  const ordenes2 = getStmt.get();

  if (!ordenes2) {

   
 
    rs.status(200).json({
      success: true,
      error: 'Pending message not found'
    });


    return 'ok';
  }

  
  const id = ordenes2.id;
  const questionText = ordenes2.message;
  const from_phone = ordenes2.from_phone;
  const original_sent_date =  ordenes2.sent_to_ai;
  const from_id =  ordenes2.from_id;
  const status =  ordenes2.status;


  const now = new Date();

 const server_date  = new Date(
  now.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' })
);

  const sentDate = new Date(original_sent_date);
  const diffMinutes = (server_date - sentDate) / 1000 / 60; // diferencia en minutos

  if ((diffMinutes > 5) && (status == 'Sent to AI' || status == 'AI RESPOND ERROR RETRY'  ))  {
     
// ===============================
  // 2️⃣ UPDATE STATUS -> ERROR
  // ===============================
  const updateSentStmt = db.prepare(`
    UPDATE ai_message_queue
    SET status = ?, 
        receive_from_ai = ?
    WHERE id = ?
  `);

  updateSentStmt.run(
    'AI_ERROR_TIME_OUT',
    sentToAiTime,
    id
  );

  
  const updateCompletedStmt = db.prepare(`
  UPDATE whatsapp_Inbound_message_queue
  SET status = ?  
  WHERE id <= ? and from_phone = ? and (status = 'Sent to AI' or status = 'AI RESPOND ERROR RETRY')
  `);
            

  updateCompletedStmt.run(
            'AI_ERROR_TIME_OUT',
            from_id,
            from_phone,
           );


  
    rs.status(200).json({
      success: false,
      error: 'Error AI time_out'
    });

    return 'OK';
     
  }   
 
  if (status == 'Sent to AI')
     {
        rs.status(200).json({
          success: false,
          error: 'Processing previous AI messages. No action done'
        });

       return 'OK'; 
     }


  // ===============================
  // 2️⃣ UPDATE STATUS -> set to AI
  // ===============================
  const updateSentStmt = db.prepare(`
    UPDATE ai_message_queue
    SET status = ?, 
        sent_to_ai = CASE 
        WHEN sent_to_ai IS NULL THEN ? 
        ELSE sent_to_ai 
    END
    WHERE id = ?
  `);

  updateSentStmt.run(
    'Sent to AI',
    sentToAiTime,
    id
  );

  
  const updateSentToAIStmt = db.prepare(`
  UPDATE whatsapp_Inbound_message_queue
  SET status = ?,sent_to_ai = ? 
  WHERE id <= ? and from_phone = ? and status = 'Pending'
  `);
            

  updateSentToAIStmt.run(
            'Sent to AI',
            sentToAiTime,
            from_id,
            from_phone,
           );
  
 



  // ===============================
  // 3️⃣ CALL AI SERVICE
  // ===============================
  let data = JSON.stringify({
    session_id: ordenes2.from_phone,
    question: questionText
  });

   
  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'http://localhost:8964/ask',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
    data: data
  };


  try {
    const response = await axios.request(config);
    
    respond_original = response.data.answer;

    respond = await  cleanLLMSpam(ordenes2.from_phone,response.data.answer);

    console.log('respond_original ' + respond_original);
    console.log('respond ' + respond);
    

  } catch (error) {
    console.log(error);
    console.log('error aibres ' + error.message);
  }

        let history = [];
        try {

        } catch (err) {
        console.log('Redis history error:', err.message);
        }

      var cantidad_mensaje  = 0;
      
      cantidad_mensaje =  await getMessageCount(ordenes2.from_phone,'assistant',respond);
        
       
      alreadyRespondedMoreThanOnce = cantidad_mensaje > 1;
       
              
     if (
            respond_original &&
            respond_original.trim() !== ''  

            )
     { 

            // ===============================
            // 4️⃣ UPDATE RECORD AFTER AI RESPONSE
            // ===============================
            const dateObj2 = new Date();
            const receiveFromAiTime = formatDateToYYYYMMDD(dateObj2.toLocaleString('en-US', { 
                timeZone: 'America/Santo_Domingo' 
            }));

            const diffMs = Math.abs(dateObj2 - dateObj);
            const seconds = Math.floor(diffMs / 1000);

            
            const updateCompletedStmt = db.prepare(`
                UPDATE whatsapp_Inbound_message_queue
                SET automatic_ai_respond = ?, 
                    status = ?, 
                    ai_processing_time = ?, 
                    receive_from_ai = ?
                WHERE id <= ? and from_phone = ? and status = 'Sent to AI'
            `);
            
            if  (respond.trim() == '')// after clean, all answer was not new
                alreadyRespondedMoreThanOnce = true;
                 

            if (alreadyRespondedMoreThanOnce)
               respond = 'Duplicated answer detected by model. Not sent to customer. Respond: ' + respond_original;

           

            updateCompletedStmt.run(
                respond,
                'Completed',
                seconds.toString(),
                receiveFromAiTime,
                from_id,
                from_phone,
     
            );



             const updateAiCompletedStmt = db.prepare(`
                UPDATE ai_message_queue
                SET automatic_ai_respond = ?, 
                    status = ?, 
                    ai_processing_time = ?, 
                    receive_from_ai = ?
                WHERE id = ? and from_phone = ? and status = 'Sent to AI'
            `);
            


            updateAiCompletedStmt.run(
                respond,
                'Completed',
                seconds.toString(),
                receiveFromAiTime,
                id,
                from_phone,
     
            );

            
            // ===============================
            // 5️⃣ SEND WHATSAPP IF VALID RESPONSE
            // ===============================
            if (
                respond && !respond.toLowerCase().includes('information not found') &&
                respond !== 'MAX MESSAGE PER CUSTOMER REACHED' && 
                !alreadyRespondedMoreThanOnce 
                )   
                {
                whatsappsend(ordenes2.from_phone, respond, 'false', '8082');
            }
    }
    else  
      {
        //reintentar llamado
          // Enviar al webhook
  
        const dateObj2 = new Date();
        const receiveFromAiTime = formatDateToYYYYMMDD(dateObj2.toLocaleString('en-US', { 
                timeZone: 'America/Santo_Domingo' 
            }));   

        const updateCompletedStmt = db.prepare(`
                UPDATE ai_message_queue
                SET status = ?
                WHERE id = ?
            `);
            


            updateCompletedStmt.run(
                'AI RESPOND ERROR RETRY',
                id
            );
    
       var dont_duplicate_text = '';

       if (alreadyRespondedMoreThanOnce)
          dont_duplicate_text = '\n \n give me a new respond different from: ' + respond;

                


       await axios.post('http://localhost:8082/aibres', {
       param1: questionText,
       param2: id
      });

        


      }     

  // Close DB (optional but clean)
  db.close();

     rs.status(200).json({
      success: true,
      error: 'Ok'
    });

});


app.post("/wssndque", async function (req, rs) {    

    const Database = require('better-sqlite3');
     const axios = require('axios');

    const db = new Database(dbPath);

    let delay_envio = 0;

    // Get all pending messages
    const pendingMessages = db.prepare(`
        SELECT * FROM whatsapp_message_queue
        WHERE status = 'Pending'
        ORDER BY id DESC
    `).all();

    for (const PO of pendingMessages) {

        delay_envio += 1000;

        setTimeout(async () => {

            try {

                const url = `http://localhost:${PO.from_phone}/send-message`;

                const es_grupo = PO.is_group === 'true' ? true : false;

                let data = {
                    number: PO.to_phone,
                    message: PO.message,
                    isgroup: es_grupo
                };

                if (PO.image) {
                    data.imageUrl = PO.image;
                }

                await axios.post(url, data, {
                    headers: { 'Content-Type': 'application/json' }
                });

                
                // Update status to completed
                const dateObj = formatDateToYYYYMMDD(new Date().toLocaleString('en-US', {
                    timeZone: 'America/Santo_Domingo'
                }));

                db.prepare(`
                    UPDATE whatsapp_message_queue
                    SET status = ?, send_date = ?
                    WHERE id = ?
                `).run('completed', dateObj, PO.id);

            } catch (error) {

                console.error(`Error sending message ID ${PO.id}:`, error.message);

                // Optional: mark as failed
                db.prepare(`
                    UPDATE whatsapp_message_queue
                    SET status = ?
                    WHERE id = ?
                `).run('failed', PO.id);
            }

        }, delay_envio);
    }



});

const PORT = 8082;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 