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

// Função para dividir áudio em chunks de 20MB (limite do Whisper)
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
      .on('end', () => {
        const chunkFiles = fs.readdirSync(chunksDir)
          .filter(file => file.startsWith(`${audioFileName}_chunk_`))
          .sort()
          .map(file => path.join(chunksDir, file));
        
        console.log(`${chunkFiles.length} chunks criados`);
        resolve(chunkFiles);
      })
      .on('error', reject)
      .run();
  });
}

// Função para transcrever um chunk com Whisper
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
      timeout: 120000
    });

    return response.data;
  } catch (error) {
    console.error(`Erro ao transcrever chunk ${path.basename(chunkPath)}:`, error.message);
    throw error;
  }
}

// Função para processar texto com ChatGPT e separar falas
async function separateSpeakersWithChatGPT(transcriptionText, apiKey) {
  console.log('Usando ChatGPT para separar falas por pessoa...');
  
  // Dividir o texto em partes menores se for muito longo
  const maxLength = 3000; // Limite para não exceder tokens do ChatGPT
  const textParts = [];
  
  for (let i = 0; i < transcriptionText.length; i += maxLength) {
    textParts.push(transcriptionText.substring(i, i + maxLength));
  }
  
  let organizedParts = [];
  
  for (let i = 0; i < textParts.length; i++) {
    try {
      console.log(`Processando parte ${i + 1}/${textParts.length} com ChatGPT...`);
      
      const prompt = `Você é um especialista em análise de conversas. Sua tarefa é identificar e separar as falas de diferentes pessoas em uma transcrição de áudio.

INSTRUÇÕES:
1. Analise o texto e identifique quando uma pessoa diferente está falando
2. Separe as falas usando o formato "**Pessoa 1:**" e "**Pessoa 2:**"
3. Identifique mudanças de pessoa por:
   - Mudanças no estilo de fala
   - Perguntas e respostas
   - Pausas naturais na conversa
   - Contexto e conteúdo das falas
4. Mantenha todo o conteúdo original, apenas organize por pessoa

TEXTO PARA ANALISAR:
${textParts[i]}

RESPOSTA (organize por pessoa):`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini', // Modelo mais barato e eficiente
        messages: [
          {
            role: 'system',
            content: 'Você é um especialista em análise de conversas que identifica diferentes pessoas falando em transcrições de áudio. Seja preciso ao separar as falas.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.1 // Baixa temperatura para ser mais preciso
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (response.data.choices && response.data.choices[0]) {
        organizedParts.push(response.data.choices[0].message.content);
      } else {
        organizedParts.push(`**Parte ${i + 1}:**\n${textParts[i]}`);
      }
      
      // Pequena pausa entre requisições
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`Erro ao processar parte ${i + 1} com ChatGPT:`, error.message);
      organizedParts.push(`**Parte ${i + 1} (Erro na análise):**\n${textParts[i]}`);
    }
  }
  
  return organizedParts.join('\n\n');
}

// Função principal de transcrição com separação de falas
async function transcribeWithSpeakerSeparation(audioPath, apiKey) {
  try {
    const audioStats = fs.statSync(audioPath);
    const maxChunkSize = 20 * 1024 * 1024; // 20MB

    let chunkPaths = [];
    
    if (audioStats.size > maxChunkSize) {
      console.log('Áudio muito grande, dividindo em chunks...');
      chunkPaths = await splitAudioIntoChunks(audioPath, 600); // 10 minutos por chunk
    } else {
      console.log('Áudio pequeno o suficiente, processando diretamente');
      chunkPaths = [audioPath];
    }

    // Etapa 1: Transcrever todos os chunks
    console.log('=== TRANSCREVENDO ÁUDIO ===');
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
        transcriptions.push(`[Erro na transcrição do segmento ${i + 1}]`);
      }
    }

    // Etapa 2: Juntar transcrição completa
    const fullTranscription = transcriptions.join(' ');
    console.log(`Transcrição completa: ${fullTranscription.length} caracteres`);

    // Etapa 3: Separar falas com ChatGPT
    console.log('=== SEPARANDO FALAS POR PESSOA ===');
    const organizedTranscription = await separateSpeakersWithChatGPT(fullTranscription, apiKey);

    // Limpar chunks temporários
    if (chunkPaths.length > 1) {
      chunkPaths.forEach(chunkPath => {
        if (chunkPath !== audioPath) {
          try {
            fs.unlinkSync(chunkPath);
          } catch (err) {
            console.error('Erro ao limpar chunk:', err.message);
          }
        }
      });
    }

    return {
      text: fullTranscription,
      organized: organizedTranscription,
      chunks: chunkPaths.length,
      method: 'OpenAI Whisper + ChatGPT 4o-mini'
    };

  } catch (error) {
    console.error('Erro na transcrição com separação:', error.message);
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
  console.log('=== INICIANDO PROCESSAMENTO COM SEPARAÇÃO REAL DE FALAS ===');
  
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
        .audioChannels(1) // Mono
        .audioFrequency(16000) // 16kHz
        .audioBitrate('64k') // Bitrate baixo
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

    // Etapa 2: Transcrever com separação real de falas
    console.log('=== ETAPA 2: Transcrevendo com separação real de falas ===');
    const transcriptionResult = await transcribeWithSpeakerSeparation(audioPath, apiKey);

    console.log('=== ETAPA 3: Finalizando ===');
    console.log(`Transcrição organizada: ${transcriptionResult.organized.length} caracteres`);

    // Limpar arquivos temporários
    const filesToClean = [videoPath, audioPath];
    setTimeout(() => cleanupFiles(filesToClean), 5000);

    res.status(200).json({
      message: 'Vídeo processado com separação real de falas!',
      transcription: transcriptionResult.text,
      organized_transcription: transcriptionResult.organized,
      stats: {
        originalSize: `${(req.file.size / 1024 / 1024).toFixed(2)}MB`,
        audioSize: `${(audioStats.size / 1024 / 1024).toFixed(2)}MB`,
        chunks: transcriptionResult.chunks,
        transcriptionLength: transcriptionResult.text.length,
        organizedLength: transcriptionResult.organized.length,
        diarization: 'ChatGPT 4o-mini',
        method: transcriptionResult.method
      }
    });

    console.log('=== PROCESSAMENTO CONCLUÍDO COM SUCESSO ===');

  } catch (error) {
    console.error('=== ERRO NO PROCESSAMENTO ===', error);
    
    const filesToClean = [videoPath, audioPath];
    cleanupFiles(filesToClean);
    
    res.status(500).json({
      error: 'Erro no processamento do vídeo',
      details: error.message
    });
  }
});

// Endpoints de saúde e raiz
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features: {
      openai_whisper: !!process.env.TRANSCRIPTION_API_KEY,
      chatgpt_speaker_separation: !!process.env.TRANSCRIPTION_API_KEY,
      real_diarization: true
    }
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'BMZ - Servidor com Separação REAL de Falas!',
    version: '5.0.0',
    features: ['Video upload', 'Audio conversion', 'Real speaker separation', 'OpenAI Whisper + ChatGPT 4o-mini'],
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
  res.status.json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 BMZ Backend v5.0 com Separação REAL de Falas`);
  console.log(`🎥 Suporte a vídeos grandes`);
  console.log(`🎙️ Whisper para transcrição`);
  console.log(`🤖 ChatGPT 4o-mini para separação de falas`);
  console.log(`👥 Separação real por pessoa`);
});