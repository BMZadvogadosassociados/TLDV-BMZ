const express = require('express');
const multer = require('multer');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors'); // Precisaremos adicionar isso às dependências

const app = express();
const PORT = process.env.PORT || 3000;

// Habilitar CORS para permitir requisições do frontend
app.use(cors());

// Servir arquivos estáticos (frontend)
app.use(express.static('public'));

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
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
  }

  const videoPath = path.join('uploads', req.file.filename);
  const mp3Path = path.join('audios', `${req.file.filename}.mp3`);

  ffmpeg(videoPath)
    .toFormat('mp3')
    .on('error', (err) => {
      console.error('Erro na conversão:', err);
      res.status(500).json({ error: 'Erro na conversão de áudio' });
    })
    .on('end', async () => {
      try {
        // Criando um FormData corretamente
        const formData = new FormData();
        formData.append('audio', fs.createReadStream(mp3Path));
        
        // Opcional: adicionar metadados se necessário
        formData.append('client', 'BMZ');
        
        // URL da API de transcrição - substitua pela sua URL real
        const transcriptionApiUrl = process.env.TRANSCRIPTION_API_URL || 'https://api.transcricao-exemplo.com/webhook';
        
        // Enviando para a API de transcrição
        const response = await axios.post(transcriptionApiUrl, formData, {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${process.env.TRANSCRIPTION_API_KEY || 'sua-chave-api'}`
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });

        console.log('Resposta da API de transcrição:', response.data);
        res.status(200).json({ 
          message: 'Vídeo processado e áudio enviado para transcrição com sucesso!',
          transcriptionId: response.data.id || 'pending'
        });

        // Limpa arquivos temporários após envio bem-sucedido
        // Comentado para debugging - descomente quando estiver tudo funcionando
        /*
        fs.unlinkSync(videoPath);
        fs.unlinkSync(mp3Path);
        */
        
      } catch (error) {
        console.error('Erro ao enviar para a API:', error.message);
        res.status(500).json({ 
          error: 'Erro ao enviar para a API de transcrição',
          details: error.message
        });
      }
    })
    .save(mp3Path);
});

// Endpoint para verificar status da transcrição (opcional)
app.get('/transcription/:id', async (req, res) => {
  try {
    const transcriptionId = req.params.id;
    const apiUrl = `${process.env.TRANSCRIPTION_API_URL}/status/${transcriptionId}`;
    
    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.TRANSCRIPTION_API_KEY || 'sua-chave-api'}`
      }
    });
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao verificar status da transcrição' });
  }
});

app.get('/', (_, res) => res.send('Servidor de Transcrição ON!'));

app.listen(PORT, () => {
  console.log(`Rodando em http://localhost:${PORT}`);
});