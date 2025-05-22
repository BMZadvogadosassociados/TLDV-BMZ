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

// Configurar CORS
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'https://seu-frontend.vercel.app',
    /\.vercel\.app$/
  ],
  credentials: true
}));

app.use(express.json());

// Criar diretórios necessários
const uploadsDir = path.join(__dirname, 'uploads');
const audiosDir = path.join(__dirname, 'audios');
const chunksDir = path.join(__dirname, 'chunks');

[uploadsDir, audiosDir, chunksDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

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
    fileSize: 3 * 1024 * 1024 * 1024, // 3GB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de vídeo são permitidos'), false);
    }
  }
});

// Função para dividir áudio em chunks de 20MB
function splitAudioIntoChunks(audioPath, chunkDuration = 600) { // 10 minutos por chunk
  return new Promise((resolve, reject) => {
    const chunks = [];
    const audioFileName = path.basename(audioPath, path.extname(audioPath));
    const chunkPattern = path.join(chunksDir, `${audioFileName}_chunk_%03d.mp3`);
    
    console.log(`Dividindo áudio em chunks de ${chunkDuration} segundos...`);
    
    ffmpeg(audioPath)
      .outputOptions([
        '-f', 'segment',
        '-segment_time', chunkDuration.toString(),
        '-c', 'copy'
      ])
      .output(chunkPattern)
      .on('start', (commandLine) => {
        console.log('Comando de divisão:', commandLine);
      })
      .on('end', () => {
        // Encontrar todos os chunks criados
        const chunkFiles = fs.readdirSync(chunksDir)
          .filter(file => file.startsWith(`${audioFileName}_chunk_`))
          .sort()
          .map(file => path.join(chunksDir, file));
        
        console.log(`${chunkFiles.length} chunks criados`);
        resolve(chunkFiles);
      })
      .on('error', (err) => {
        console.error('Erro ao dividir áudio:', err);
        reject(err);
      })
      .run();
  });
}

// Função para transcrever um chunk usando OpenAI Whisper
async function transcribeChunk(chunkPath, apiKey) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(chunkPath));
  formData.append('model', 'whisper-1');
  formData.append('language', 'pt');
  formData.append('response_format', 'text');
  
  try {
    console.log(`Transcrevendo chunk: ${path.basename(chunkPath)}`);
    
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${apiKey}`
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000 // 2 minutos timeout por chunk
    });

    return response.data;
  } catch (error) {
    console.error(`Erro ao transcrever chunk ${path.basename(chunkPath)}:`, error.message);
    throw error;
  }
}

// Função para limpar arquivos temporários
function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`Arquivo removido: ${path.basename(file)}`);
      }
    } catch (err) {
      console.error(`Erro ao remover arquivo ${file}:`, err.message);
    }
  });
}

// Endpoint principal
app.post('/upload', upload.single('video'), async (req, res) => {
  console.log('=== INICIANDO PROCESSAMENTO DE VÍDEO ===');
  
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
  }

  const videoPath = path.join(uploadsDir, req.file.filename);
  const audioPath = path.join(audiosDir, `${req.file.filename}.mp3`);
  const apiKey = process.env.TRANSCRIPTION_API_KEY;

  if (!apiKey || apiKey === 'test-key') {
    return res.status(400).json({ 
      error: 'API Key da OpenAI não configurada',
      message: 'Configure TRANSCRIPTION_API_KEY nas variáveis de ambiente'
    });
  }

  console.log(`Arquivo recebido: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);

  try {
    // Etapa 1: Converter vídeo para áudio
    console.log('=== ETAPA 1: Convertendo vídeo para áudio ===');
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .toFormat('mp3')
        .audioChannels(1) // Mono para reduzir tamanho
        .audioFrequency(16000) // 16kHz para otimizar para fala
        .audioBitrate('64k') // Bitrate baixo para reduzir tamanho
        .on('start', (commandLine) => {
          console.log('Conversão iniciada:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Progresso da conversão: ${Math.round(progress.percent)}%`);
          }
        })
        .on('error', reject)
        .on('end', resolve)
        .save(audioPath);
    });

    const audioStats = fs.statSync(audioPath);
    console.log(`Áudio convertido: ${(audioStats.size / 1024 / 1024).toFixed(2)}MB`);

    // Etapa 2: Dividir áudio em chunks se necessário
    console.log('=== ETAPA 2: Verificando necessidade de divisão ===');
    let chunkPaths = [];
    
    const maxChunkSize = 20 * 1024 * 1024; // 20MB
    if (audioStats.size > maxChunkSize) {
      console.log('Áudio muito grande, dividindo em chunks...');
      chunkPaths = await splitAudioIntoChunks(audioPath, 600); // 10 minutos por chunk
    } else {
      console.log('Áudio pequeno o suficiente, processando diretamente');
      chunkPaths = [audioPath];
    }

    // Etapa 3: Transcrever todos os chunks
    console.log('=== ETAPA 3: Transcrevendo áudio ===');
    const transcriptions = [];
    
    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i];
      console.log(`Transcrevendo chunk ${i + 1}/${chunkPaths.length}`);
      
      try {
        const transcription = await transcribeChunk(chunkPath, apiKey);
        transcriptions.push(transcription);
        console.log(`Chunk ${i + 1} transcrito com sucesso`);
      } catch (error) {
        console.error(`Erro no chunk ${i + 1}:`, error.message);
        // Continuar com os outros chunks mesmo se um falhar
        transcriptions.push(`[Erro na transcrição do segmento ${i + 1}]`);
      }
    }

    // Etapa 4: Juntar todas as transcrições
    console.log('=== ETAPA 4: Finalizando ===');
    const fullTranscription = transcriptions.join(' ');
    
    console.log(`Transcrição completa: ${fullTranscription.length} caracteres`);

    // Limpar arquivos temporários
    const filesToClean = [videoPath, audioPath, ...chunkPaths.filter(path => path !== audioPath)];
    setTimeout(() => cleanupFiles(filesToClean), 5000);

    res.status(200).json({
      message: 'Vídeo processado e transcrito com sucesso!',
      transcription: fullTranscription,
      stats: {
        originalSize: `${(req.file.size / 1024 / 1024).toFixed(2)}MB`,
        audioSize: `${(audioStats.size / 1024 / 1024).toFixed(2)}MB`,
        chunks: chunkPaths.length,
        transcriptionLength: fullTranscription.length
      }
    });

    console.log('=== PROCESSAMENTO CONCLUÍDO COM SUCESSO ===');

  } catch (error) {
    console.error('=== ERRO NO PROCESSAMENTO ===', error);
    
    // Limpar arquivos em caso de erro
    const filesToClean = [videoPath, audioPath];
    cleanupFiles(filesToClean);
    
    res.status(500).json({
      error: 'Erro no processamento do vídeo',
      details: error.message
    });
  }
});

// Endpoint de saúde
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// Endpoint raiz
app.get('/', (req, res) => {
  res.json({ 
    message: 'BMZ - Servidor de Transcrição com Chunks está funcionando!',
    version: '2.0.0',
    features: ['Video upload', 'Audio conversion', 'Audio chunking', 'OpenAI Whisper transcription'],
    endpoints: ['/upload', '/health']
  });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Arquivo muito grande. Máximo 3GB.' });
    }
  }
  
  console.error('Erro não tratado:', error);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 BMZ Backend v2.0 rodando na porta ${PORT}`);
  console.log(`🎥 Suporte a vídeos grandes com divisão em chunks`);
  console.log(`🎙️ Integração com OpenAI Whisper`);
});