const express = require('express');
const multer = require('multer');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar CORS para permitir requisições do seu frontend no Vercel
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'https://seu-frontend.vercel.app', // Substitua pela sua URL real do Vercel
    /\.vercel\.app$/ // Permite qualquer subdomínio do Vercel
  ],
  credentials: true
}));

// Middleware para parsing JSON
app.use(express.json());

// Cria pastas se não existirem
const uploadsDir = path.join(__dirname, 'uploads');
const audiosDir = path.join(__dirname, 'audios');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(audiosDir)) fs.mkdirSync(audiosDir);

// Configuração do multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (req, file, cb) => {
    // Verificar se é um arquivo de vídeo
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de vídeo são permitidos'), false);
    }
  }
});

// Endpoint principal para upload e processamento
app.post('/upload', upload.single('video'), (req, res) => {
  console.log('Recebendo upload de vídeo...');
  
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
  }

  const videoPath = path.join(uploadsDir, req.file.filename);
  const mp3Path = path.join(audiosDir, `${req.file.filename}.mp3`);

  console.log(`Convertendo vídeo: ${req.file.filename}`);

  ffmpeg(videoPath)
    .toFormat('mp3')
    .audioChannels(1) // Mono para reduzir tamanho
    .audioFrequency(16000) // 16kHz é suficiente para fala
    .on('start', (commandLine) => {
      console.log('FFmpeg iniciado:', commandLine);
    })
    .on('progress', (progress) => {
      console.log('Progresso:', Math.round(progress.percent) + '%');
    })
    .on('error', (err) => {
      console.error('Erro na conversão FFmpeg:', err);
      
      // Limpar arquivo de vídeo em caso de erro
      try {
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      } catch (cleanupErr) {
        console.error('Erro ao limpar arquivo:', cleanupErr);
      }
      
      res.status(500).json({ 
        error: 'Erro na conversão de áudio',
        details: err.message 
      });
    })
    .on('end', async () => {
      console.log('Conversão concluída, enviando para API de transcrição...');
      
      try {
        // Criar FormData para envio
        const formData = new FormData();
        formData.append('audio', fs.createReadStream(mp3Path));
        
        // Adicionar metadados se necessário
        formData.append('language', 'pt-BR');
        formData.append('model', 'whisper-1');
        
        // URL da API de transcrição - configure via variáveis de ambiente no Render
        const transcriptionApiUrl = process.env.TRANSCRIPTION_API_URL || 'https://api.openai.com/v1/audio/transcriptions';
        const apiKey = process.env.TRANSCRIPTION_API_KEY || 'sua-chave-api';
        
        console.log('Enviando para API de transcrição...');
        
        const response = await axios.post(transcriptionApiUrl, formData, {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${apiKey}`
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000 // 60 segundos
        });

        console.log('Transcrição concluída com sucesso');
        
        res.status(200).json({ 
          message: 'Vídeo processado e áudio enviado para transcrição com sucesso!',
          transcriptionId: response.data.id || 'completed',
          transcription: response.data.text || 'Transcrição processada'
        });

        // Limpar arquivos temporários após sucesso
        setTimeout(() => {
          try {
            if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
            console.log('Arquivos temporários limpos');
          } catch (cleanupErr) {
            console.error('Erro ao limpar arquivos:', cleanupErr);
          }
        }, 5000); // Aguarda 5 segundos antes de limpar
        
      } catch (error) {
        console.error('Erro ao enviar para API de transcrição:', error.message);
        
        // Limpar arquivos em caso de erro
        try {
          if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
          if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
        } catch (cleanupErr) {
          console.error('Erro ao limpar arquivos:', cleanupErr);
        }
        
        res.status(500).json({ 
          error: 'Erro ao enviar para a API de transcrição',
          details: error.response?.data?.error?.message || error.message
        });
      }
    })
    .save(mp3Path);
});

// Endpoint para verificar saúde do servidor
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Endpoint raiz
app.get('/', (req, res) => {
  res.json({ 
    message: 'BMZ - Servidor de Transcrição está funcionando!',
    version: '1.0.0',
    endpoints: ['/upload', '/health']
  });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Arquivo muito grande. Máximo 100MB.' });
    }
  }
  
  console.error('Erro não tratado:', error);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor BMZ rodando na porta ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
});