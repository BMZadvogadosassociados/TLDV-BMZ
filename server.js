const express = require('express');
const multer = require('multer');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Cria pastas se não existirem
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('audios')) fs.mkdirSync('audios');

// Configuração do multer para salvar os arquivos em /uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.post('/upload', upload.single('video'), (req, res) => {
  const videoPath = path.join('uploads', req.file.filename);
  const mp3Path = path.join('audios', `${req.file.filename}.mp3`);

  ffmpeg(videoPath)
    .toFormat('mp3')
    .save(mp3Path)
    .on('end', async () => {
      try {
        // Envia o MP3 para a API de transcrição via webhook
        const formData = new FormData();
        formData.append('audio', fs.createReadStream(mp3Path));

        await axios.post('https://SUA-API-TRANSCRICAO.com/webhook', formData, {
          headers: formData.getHeaders()
        });

        res.status(200).json({ message: 'Transcrição enviada com sucesso!' });

        // Limpa arquivos temporários
        fs.unlinkSync(videoPath);
        fs.unlinkSync(mp3Path);
      } catch (error) {
        console.error('Erro ao enviar para a API:', error);
        res.status(500).json({ error: 'Erro ao enviar para a API' });
      }
    })
    .on('error', (err) => {
      console.error('Erro na conversão:', err);
      res.status(500).json({ error: 'Erro na conversão de áudio' });
    });
});

app.get('/', (_, res) => res.send('Servidor de Transcrição ON!'));

app.listen(PORT, () => {
  console.log(`Rodando em http://localhost:${PORT}`);
});
