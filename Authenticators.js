import express from 'express';
import cors from 'cors';
import bodyParser from "body-parser";

import mysql from "mysql2";

import pkg from 'whatsapp-web.js'
import { Resend } from 'resend';

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

//==================== cron.schedule ===========================
// Agendamento de requisição a cada 3 horas
cron.schedule("0 */2 * * *", () => {
  //send request to route '/api/v1/ping-db'
  axios.post("https://barbeasy-authenticators.up.railway.app/api/v1/ping-db")
  .then(res =>{
    console.log(res.data)
  }).catch(err =>{
    console.error(err);
  }) 
});

app.post("/api/v1/ping-db", (req, res) =>{
db.query('SELECT name FROM user', (err, resu) => {
  if (err) {
      console.error('Erro ao consultar DB:', err);
      return res.status(500).send('Erro ao manter o banco ativo');
  }
  if(resu){
    console.log(resu.length);
    return res.send('Banco de dados ativo...');
  }
  });
})

// Function to generate a code of 5 digt
const generateVerificationCode = () => {
  return Math.floor(10000 + Math.random() * 90000);
};

function generatePassword() {
  // Definindo os caracteres permitidos
  const allowedChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@.#%';
  let password = '';

  // Gerando uma senha de 8 caracteres
  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor(Math.random() * allowedChars.length);
    password += allowedChars[randomIndex];
  }

  return password;
}
//===================== Whatsapp Auth =======================

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

whatsappClient.initialize();

//Route to send mensagem for user's whatsApp
app.put("/api/v1/sendCodeWhatsapp", (req, res) =>{
  const phoneNumberToSendMessage = req.body.phoneNumberToSendMessage;
  const email = req.body.email;
  const phoneNumberToFindUser = req.body.phoneNumberToFindUser;
  const type = req.body.type;

  const verificationCode = generateVerificationCode()
  const message = `Seu código de verificação é ${verificationCode}. Não compartilhe-o com niguém.`;

  let sql = '';
  let params = '';

  if(type === 'barbearia'){
    sql = 'UPDATE barbearia '
  } else if(type === 'client'){
    sql = 'UPDATE user '
  }
  //Monta a query para as requisições de Ativação e/ou recuperação de conta
  if(email){
    sql = sql + 'SET isVerified = ? WHERE email = ?';
    params = email
  }
  //Monta a query para as requisições de Redefinição de senha
  if(phoneNumberToFindUser){
    sql = sql + 'SET isVerified = ? WHERE celular = ?';
    params = phoneNumberToFindUser
  }
  
  db.query(sql, [verificationCode, params], (err, resul) =>{
    if(err){
      console.error('Erro ao salvar código de autenticação:', err);
      return res.status(500).send('Erro ao salvar código de autenticação.');
    }
    if(resul.affectedRows === 1){
      whatsappClient.sendMessage(phoneNumberToSendMessage, message)
      .then(() =>{
        return res.status(200).send('Código de autenticação enviado.')
      })
      .catch((err) =>{
        console.error('Erro ao enviar código de autenticação:', err);
        return res.status(500).send('Erro ao enviar código de autenticação.');
      })
    }
    if(resul.affectedRows === 0){
      return res.status(204).send('Usuário não encontrado.')
    }
  })
})

//Route to resend mensagem for user's whatsApp
app.post("/api/v1/resendCodeWhatsapp", (req, res) =>{
  const {phoneNumberToSendMessage, phoneNumberToSotorage, email} = req.body;

  const verificationCode = generateVerificationCode()
  const message = `Seu código de verificação é ${verificationCode}. Não compartilhe-o com niguém.`;

  const sql = 'UPDATE user SET celular = ?, isVerified = ? WHERE email = ?';
  db.query(sql, [phoneNumberToSotorage, verificationCode, email], (err, resul) =>{
    if(err){
      console.error('Erro ao atualizar o número e ao salvar o código de autenticação:', err);
      return res.status(500).send('Erro ao atualizar o número e ao salvar o código de autenticação.');
    }
    if(resul){
      whatsappClient.sendMessage(phoneNumberToSendMessage, message)
      .then(() =>{
        res.status(200).send('Código de autenticação reenviado.')
      })
      .catch((err) =>{
        console.error('Erro ao reenviar código de autenticação:', err);
        res.status(500).send('Erro ao reenviar código de autenticação.');
      })
    }
  })
})

//Route to verify if code send from user is valided
app.put("/api/v1/verifyUserCode-WhatsApp", (req, res) =>{
  const {phoneNumber, email, code} = req.body;

  const sql='UPDATE user SET isVerified = ? WHERE email = ? AND celular = ? AND isVerified = ?'
  db.query(sql, ['true', email, phoneNumber, code], (err, resu) =>{
    if(err){
      console.error('Erro ao verificar código de autenticação do usuário:', err);
      return res.status(500).send('Erro ao verificar código de autenticação do usuário.');
    }
    if(resu.affectedRows === 1){
      return res.status(201).send('Conta ativada com sucesso.')
    }
    if(resu.affectedRows === 0){
      return res.status(204).send('Código de autenticação incorreto.')
    }
  })
})

//Route to get user's data for Auth
app.get("/api/v1/dataToAuth/:email/:phoneNumber/:type", (req, res) =>{
  const email = req.params.email;
  const phoneNumber = req.params.phoneNumber;
  const type = req.params.type;

  let sql = '';

  if(type === 'barbearia'){
    sql = 'SELECT celular FROM barbearia WHERE email = ? AND celular = ?'
  } else if(type === 'client'){
    sql = 'SELECT celular FROM user WHERE email = ? AND celular = ?'
  }

  db.query(sql, [email, phoneNumber], (err, resu) =>{
    if(err){
      console.error('Erro ao buscar o celular do usuário:', err);
      return res.status(500).send('Erro ao buscar o celular do usuário.');
    }
    if(resu){
      return res.status(201).json({phone: resu})
    }
  })
})

//====================== Settings to send emails ========================
const resend = new Resend(process.env.RESEND_API_KEY);

//Function to send a code verification to email
const sendCodeAutenticationToEmail = async (email, verificationCode) => {
  try {
    const response = await resend.emails.send({
      from: 'Barbeasy Segurança <no-reply@barbeasy.com.br>', // Ajuste na formatação do e-mail
      to: email,
      subject: 'Verificação de E-mail',
      html: `<p>Seu código de verificação é <strong>${verificationCode}</strong>. Não compartilhe-o com niguém.</p>`,
    });
    return // Retorne a resposta se precisar manipular o resultado
  } catch (error) {
    console.error('Erro ao enviar o e-mail:', error);
    throw error; // Repropaga o erro para ser tratado externamente, se necessário
  }
};

//Function to send email
const sendNewPasswordToEmail = async (email, newPassword) => {
  try {
    const response = await resend.emails.send({
      from: 'Barbeasy Segurança <no-reply@barbeasy.com.br>', // Ajuste na formatação do e-mail
      to: email,
      subject: 'Nova Senha de Acesso',
      html: `<p>Sua nova senha de acesso é <strong>${newPassword}</strong>. Não compartilhe-a com niguém.</p>`,
    });
    return // Retorne a resposta se precisar manipular o resultado
  } catch (error) {
    console.error('Erro ao enviar o e-mail:', error);
    throw error; // Repropaga o erro para ser tratado externamente, se necessário
  }
};

//Route to send mensagem for user's whatsApp
app.put("/api/v1/sendCodeEmail", (req, res) =>{
  const {email} = req.body;

  const verificationCode = generateVerificationCode()

  const sql = 'UPDATE user SET isVerified = ? WHERE email = ?';
  db.query(sql, [verificationCode, email], (err, resul) =>{
    if(err){
      console.error('Erro ao salvar código de autenticação - Email:', err);
      return res.status(500).send('Erro ao salvar código de autenticação - Email.');
    }
    if(resul.affectedRows === 1){
      sendCodeAutenticationToEmail(email, verificationCode)
      .then(() =>{
        return res.status(200).send('Código de autenticação enviado.')
      })
      .catch((err) =>{
        console.error('Erro ao enviar código de autenticação - Email:', err);
        return res.status(500).send('Erro ao enviar código de autenticação.');
      })
    }
    if(resul.affectedRows === 0){
      return res.status(204).send('Usuário não encontrado.')
    }
  })
})

//Route to verify if code send from user is valided
app.put("/api/v1/verifyUserCode-Email", (req, res) =>{
  const {email, code} = req.body;

  const sql='UPDATE user SET isVerified = ? WHERE email = ? AND isVerified = ?'
  db.query(sql, ['true', email, code], (err, resu) =>{
    if(err){
      console.error('Erro ao verificar código de autenticação do usuário - Email:', err);
      return res.status(500).send('Erro ao verificar código de autenticação do usuário - Email.');
    }
    if(resu.affectedRows === 1){
      return res.status(201).send('Conta ativada com sucesso.')
    }
    if(resu.affectedRows === 0){
      return res.status(204).send('Código de autenticação incorreto.')
    }
  })
})

//Route to send a new password to user by email
app.put("/api/v1/sendPasswordToEmail", (req, res) =>{
  const {email, phoneNumber} = req.body;

  const newPassword = generatePassword()
  
  const sql='UPDATE user SET senha = ? WHERE email = ? AND celular = ?'
  db.query(sql, [newPassword, email, phoneNumber], (err, resu) =>{
    if(err){
      console.error('Erro ao salvar a nova senha do usuário:', err);
      return res.status(500).send('Erro ao salvar a nova senha do usuário - Email.');
    }
    if(resu.affectedRows === 1){
      sendNewPasswordToEmail(email, newPassword)
      .then(() =>{
        return res.status(201).send('Nova senha salva..')
      })
      .catch((err) =>{
        console.error('Erro ao enviar a nova senha - Email:', err);
        return res.status(500).send('Erro ao enviar código de autenticação.');
      })
    }
  })
})

//================= Reset password ===================
//Route to send a new password to user by WhatsApp
app.put("/api/v1/resetPassword", (req, res) => {
  const { methodSendCode, valueToFindUser, code } = req.body;
  const newPassword = generatePassword();
  
  let sql = '';
  if (methodSendCode.type === 'email') {
      sql = 'UPDATE user SET senha = ?, isVerified = ? WHERE email = ? AND isVerified = ?';
  } else if (methodSendCode.type === 'WhatsApp') {
      sql = 'UPDATE user SET senha = ?, isVerified = ? WHERE celular = ? AND isVerified = ?';
  } else {
      return res.status(400).send('Tipo de método inválido.');
  }

  db.query(sql, [newPassword, 'true', valueToFindUser, code], (err, resu) => {
      if (err) {
          console.error('Erro ao atualizar a senha:', err);
          return res.status(500).send('Erro ao salvar o código de verificação de redefinição de senha.');
      }
      if (resu.affectedRows === 0) {
          return res.status(204).send('Usuário não encontrado ou código inválido.');
      }

      if (resu.affectedRows === 1) {
        const message = `Sua nova senha de acesso é ${newPassword}. Não compartilhe-a com ninguém.`;
        if (methodSendCode.type === 'email') {
          sendNewPasswordToEmail(valueToFindUser, newPassword)
              .then(() => res.status(201).send('Nova senha salva.'))
              .catch(err => {
                  console.error('Erro ao enviar a nova senha - Email:', err);
                  res.status(500).send('Erro ao enviar código de autenticação.');
              });
        } else if (methodSendCode.type === 'WhatsApp') {
          whatsappClient.sendMessage(methodSendCode.value, message)
              .then(() => res.status(201).send('Código de redefinição de senha enviado.'))
              .catch(err => {
                  console.error('Erro ao enviar código de redefinição de senha - WhatsApp:', err);
                  res.status(500).send('Erro ao enviar código de redefinição de senha - WhatsApp.');
              });
      }
      }
  });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando...`);
})