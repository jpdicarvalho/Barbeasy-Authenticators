import express from 'express';
import cors from 'cors';
import bodyParser from "body-parser";

import mysql from "mysql2";

import pkg from 'whatsapp-web.js'

import morgan from 'morgan';
import winston from 'winston';
//import UAParser from 'ua-parser-js';
import rateLimit from 'express-rate-limit';

import axios from 'axios';

import cron from 'node-cron'

import 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.LOCALHOST_URL,
];
  
const corsOptions = {
origin: function (origin, callback) {
    // Verifica se a origem está na lista de URLs permitidas
    if (allowedOrigins.includes(origin) || !origin) {
    callback(null, true);
    } else {
    callback(new Error('Not allowed by CORS'));
    }
},
optionsSuccessStatus: 200 // Algumas versões de navegador podem precisar desse código
};
  

app.use(cors(corsOptions))
//app.use(limiter);// Aplicar limitação de taxa a todas as requisições
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Create the connection to the database mysql on PlanetScale
const db = mysql.createConnection(process.env.DATABASE_URL)

// Verify connection to the database
db.connect((error) => {
if (error) {
    console.error('Erro ao conectar ao banco de dados:', error.message);
} else {
    console.log('Conexão bem-sucedida ao banco de dados!');
}
});

//===================== Whatsapp API =======================

// Function to generate a code of 8 digt
const generateVerificationCode = () => {
    return Math.floor(10000 + Math.random() * 90000);
};

//Export pkg from whatsapp-web.js
const { Client, LocalAuth } = pkg;

//Create a instance
const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    dataPath: './SessionWhatsappStogare'
    }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

//Generate qrcode if not autenticated
whatsappClient.on("qr", (qr) => console.log(qr));
//Show status conection
whatsappClient.on("ready", () => console.log("Whatsapp ativo..."))

//Function to receive message
whatsappClient.on("message", async (msg) =>{
  try{
    if(msg.from != 'status@broadcast'){
      const contact = await msg.getContact()
      console.log(contact)
    }
  }catch (error) {
    console.log(error)
  }
})

//whatsappClient.initialize();

app.post("/api/v1/sendCodeWhatsapp", (req, res) =>{

  const verificationCode = generateVerificationCode()
  const message = `Seu código de verificação é ${verificationCode}. Não compartilhe-o com niguém.`;

  whatsappClient.sendMessage(req.body.phoneNumber, message)
  .then(() =>{
    res.status(200).send('Código de autenticação enviado.')
  })
  .catch((err) =>{
    console.error('Erro ao enviar código de autenticação:', err);
    res.status(500).send('Erro ao enviar código de autenticação.');
  })
})

app.listen(PORT, () => {
    console.log(`Servidor rodando...`);
})