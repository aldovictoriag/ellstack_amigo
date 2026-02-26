const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason,fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const qrcode = require('qrcode-terminal')
const P = require('pino');
const path = require('path');
const fs = require('fs'); // Para guardar logs en archivo
const Papa = require('papaparse');
const axios = require('axios'); 


//CARPETA PARA TEMPORALES
process.env.TMPDIR = path.join(__dirname, 'temp');
process.env.TEMP = path.join(__dirname, 'temp');
process.env.TMP = path.join(__dirname, 'temp');

const app = express();
app.use(express.json()); // Para parsear JSON



// Open database (it will create it if it doesn't exist)

const ellstackDir = process.env.ELLSTACK_DIR; // fallback if not set

const dbPath = path.join(ellstackDir, 'data', 'ellsdb');

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

const WEBHOOK_URL = 'http://localhost:8082/wsxwh';

let enviarRecibidos = true;    // Control para mensajes recibidos
let enviarEnviados = false;    // Control para+ mensajes enviados
let enviarGrupos = false;      // Control para mensajes que vienen de grupos

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

      // Detectar si es audio
      if (msg.message?.audioMessage) {
        text = '[Mensaje de audio]';
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

      console.log(`Mensaje de ${profileName} (${sender.split('@')[0]}) reenviado al webhook - contenido: ${text}`);

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
            console.log('Message with image sent successfully');
            res.status(200).send('Message with image sent successfully');
        } else {
            console.log('Text message sent successfully');
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

        console.log('Detalles de grupos guardados en groups.csv');
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
                console.log(`Esperando 2 minutos antes de procesar el siguiente grupo...`);
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
  verbose: console.log
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
  (receive_date, message, from_phone, to_phone, status)
  VALUES (?, ?, ?, ?, ?)
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

    function formatDateToYYYYMMDD(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

   
    var dateMsg = new Date();
    var receiveDate = dateMsg.toLocaleString('es-US', {
      timeZone: 'America/Santo_Domingo'
    });

    const result = insertMessageStmt.run(
      receiveDate,
      mensaje,
      cell_phone,
      to_phone,
      'Pending'
    );

    const mensajeGuardadoId = result.lastInsertRowid;


    

     
    /* ==============================
       AI Response (si aplica)
    ============================== */

   

       // Enviar al webhook
      await axios.post('http://localhost:8082/aibres', {
       param1: mensaje,
       param2: mensajeGuardadoId
      });

  

    /* ==============================
       Response
    ============================== */

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





app.post("/aibres", async function (req, rs) {

  
  const axios = require('axios');
  const Database = require('better-sqlite3');

  // Open SQLite database
  const db = new Database(dbPath);

  let respond = '';

  const id = req.body.param2;
  const questionText = req.body.param1;


  
  // Current timestamp
  const dateObj = new Date();
  const sentToAiTime = dateObj.toLocaleString('es-US', { 
    timeZone: 'America/Santo_Domingo' 
  });

  // ===============================
  // 1️⃣ GET CURRENT RECORD
  // ===============================
  const getStmt = db.prepare(`
    SELECT * 
    FROM whatsapp_Inbound_message_queue 
    WHERE id = ?
  `);

  const ordenes2 = getStmt.get(id);

   


  if (!ordenes2) {

   
    console.log("Record not found:", id);
    return "record not found";
  }

  
  // ===============================
  // 2️⃣ UPDATE STATUS -> Sent to AI
  // ===============================
  const updateSentStmt = db.prepare(`
    UPDATE whatsapp_Inbound_message_queue
    SET status = ?, 
        sent_to_ai = ?
    WHERE id = ?
  `);

  updateSentStmt.run(
    'Sent to AI',
    sentToAiTime,
    id
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
    respond = response.data.answer;
  } catch (error) {
    console.log(error);
    console.log('error aibres ' + error.message);
  }

 

  // ===============================
  // 4️⃣ UPDATE RECORD AFTER AI RESPONSE
  // ===============================
  const dateObj2 = new Date();
  const receiveFromAiTime = dateObj2.toLocaleString('es-US', { 
    timeZone: 'America/Santo_Domingo' 
  });

  const diffMs = Math.abs(dateObj2 - dateObj);
  const seconds = Math.floor(diffMs / 1000);

   
  const updateCompletedStmt = db.prepare(`
    UPDATE whatsapp_Inbound_message_queue
    SET automatic_ai_respond = ?, 
        status = ?, 
        ai_processing_time = ?, 
        receive_from_ai = ?
    WHERE id = ?
  `);

   
  updateCompletedStmt.run(
    respond,
    'Completed',
    seconds.toString(),
    receiveFromAiTime,
    id
  );


   
  // ===============================
  // 5️⃣ SEND WHATSAPP IF VALID RESPONSE
  // ===============================
  if (respond && respond !== 'Information not found.') {
    whatsappsend(ordenes2.from_phone, respond, 'false', '8082');
  }

  // Close DB (optional but clean)
  db.close();

  return 'ok';

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

                console.log(`Message ID ${PO.id} sent successfully`);

                // Update status to completed
                const dateObj = new Date().toLocaleString('es-US', {
                    timeZone: 'America/Santo_Domingo'
                });

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