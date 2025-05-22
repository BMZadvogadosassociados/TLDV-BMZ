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

// Função para dividir áudio em chunks menores (2 minutos cada para melhor análise)
function splitAudioIntoSmallChunks(audioPath, chunkDuration = 120) { // 2 minutos
  return new Promise((resolve, reject) => {
    const audioFileName = path.basename(audioPath, path.extname(audioPath));
    const chunkPattern = path.join(chunksDir, `${audioFileName}_chunk_%03d.mp3`);
    
    console.log(`Dividindo áudio em chunks de ${chunkDuration} segundos para análise...`);
    
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
        
        console.log(`${chunkFiles.length} chunks criados para análise`);
        resolve(chunkFiles);
      })
      .on('error', reject)
      .run();
  });
}

// Função para transcrever chunk com timestamps (usando prompt especial)
async function transcribeChunkWithSpeakers(chunkPath, chunkIndex, apiKey) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(chunkPath));
  formData.append('model', 'whisper-1');
  formData.append('language', 'pt');
  formData.append('response_format', 'verbose_json'); // Para ter timestamps
  formData.append('prompt', 'Esta é uma conversa entre duas pessoas. Identifique mudanças de voz e pausas naturais.'); // Prompt para ajudar o Whisper
  
  try {
    console.log(`Transcrevendo chunk ${chunkIndex + 1} com timestamps...`);
    
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${apiKey}`
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000
    });

    return {
      chunkIndex,
      text: response.data.text,
      segments: response.data.segments || []
    };
  } catch (error) {
    console.error(`Erro ao transcrever chunk ${chunkIndex + 1}:`, error.message);
    return {
      chunkIndex,
      text: `[Erro na transcrição do segmento ${chunkIndex + 1}]`,
      segments: []
    };
  }
}

// Função inteligente para organizar por pessoa usando análise de padrões
function organizeTranscriptionByPatterns(transcriptionChunks) {
  console.log('Organizando transcrição por padrões de fala...');
  
  let organized = '';
  let currentSpeaker = 1;
  let speakerPattern = {};
  
  // Analisar padrões em cada chunk
  transcriptionChunks.forEach((chunk, chunkIndex) => {
    if (!chunk.text || chunk.text.includes('Erro na transcrição')) {
      organized += `\n\n**Segmento ${chunkIndex + 1}:** ${chunk.text}\n`;
      return;
    }

    // Dividir por pausas longas e mudanças de contexto
    const sentences = chunk.text
      .split(/[\.\!\?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);

    sentences.forEach((sentence, sentenceIndex) => {
      // Detectar mudanças de contexto que indicam mudança de pessoa
      const contextChanges = [
        /^(sim|não|ok|certo|entendi|ah|então)/i,
        /^(doutor|doutora|senhor|senhora)/i,
        /^(agora|mas|porém|entretanto)/i,
        /\?(.*)/i // Perguntas geralmente indicam mudança de pessoa
      ];

      let shouldChangeSpeaker = false;
      
      // Verificar se há indicadores de mudança de pessoa
      if (sentenceIndex === 0 && chunkIndex > 0) {
        shouldChangeSpeaker = true; // Nova pessoa a cada chunk de 2 minutos
      } else {
        contextChanges.forEach(pattern => {
          if (pattern.test(sentence)) {
            shouldChangeSpeaker = true;
          }
        });
      }

      if (shouldChangeSpeaker) {
        currentSpeaker = currentSpeaker === 1 ? 2 : 1;
        organized += `\n\n**Pessoa ${currentSpeaker}:**\n`;
      }

      organized += sentence + '. ';
    });
  });

  return organized.trim();
}

// Função melhorada para usar OpenAI com análise inteligente
async function transcribeWithIntelligentDiarization(audioPath, apiKey) {
  try {
    const audioStats = fs.statSync(audioPath);
    const maxChunkSize = 20 * 1024 * 1024; // 20MB para Whisper

    let chunkPaths = [];
    
    if (audioStats.size > maxChunkSize) {
      console.log('Áudio grande, dividindo em chunks pequenos para análise...');
      chunkPaths = await splitAudioIntoSmallChunks(audioPath, 120); // 2 minutos cada
    } else {
      console.log('Áudio pequeno, processando diretamente...');
      chunkPaths = [audioPath];
    }

    // Transcrever todos os chunks com informações detalhadas
    const transcriptionChunks = [];
    
    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkResult = await transcribeChunkWithSpeakers(chunkPaths[i], i, apiKey);
      transcriptionChunks.push(chunkResult);
    }

    // Juntar transcrição completa
    const fullTranscription = transcriptionChunks
      .map(chunk => chunk.text)
      .join(' ');

    // Organizar por pessoa usando análise inteligente
    const organizedTranscription = organizeTranscriptionByPatterns(transcriptionChunks);

    // Usar ChatGPT para melhorar a organização (opcional)
    let improvedOrganization = organizedTranscription;
    
    try {
      console.log('Melhorando organização com ChatGPT...');
      const chatResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Você é um assistente que organiza transcrições de conversas identificando diferentes pessoas. Organize o texto separando claramente as falas de cada pessoa. Use "**Pessoa 1:**" e "**Pessoa 2:**" para identificar os falantes.'
          },
          {
            role: 'user',
            content: `Organize esta transcrição identificando quando cada pessoa fala:\n\n${fullTranscription.substring(0, 3000)}` // Primeiros 3000 caracteres para não exceder limite
          }
        ],
        max_tokens: 1500,
        temperature: 0.3
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (chatResponse.data.choices && chatResponse.data.choices[0]) {
        improvedOrganization = chatResponse.data.choices[0].message.content;
      }
    } catch (chatError) {
      console.log('ChatGPT não disponível, usando análise básica');
    }

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
      organized: improvedOrganization,
      chunks: transcriptionChunks.length,
      method: 'OpenAI Whisper + Análise Inteligente'
    };

  } catch (error) {
    console.error('Erro na transcrição inteligente:', error.message);
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
  console.log('=== INICIANDO PROCESSAMENTO COM SEPARAÇÃO INTELIGENTE ===');
  
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

    // Etapa 2: Transcrever com separação inteligente
    console.log('=== ETAPA 2: Transcrevendo com separação inteligente ===');
    const transcriptionResult = await transcribeWithIntelligentDiarization(audioPath, apiKey);

    console.log('=== ETAPA 3: Finalizando ===');
    console.log(`Transcrição completa: ${transcriptionResult.text.length} caracteres`);

    // Limpar arquivos temporários
    const filesToClean = [videoPath, audioPath];
    setTimeout(() => cleanupFiles(filesToClean), 5000);

    res.status(200).json({
      message: 'Vídeo processado e transcrito com separação inteligente!',
      transcription: transcriptionResult.text,
      organized_transcription: transcriptionResult.organized,
      stats: {
        originalSize: `${(req.file.size / 1024 / 1024).toFixed(2)}MB`,
        audioSize: `${(audioStats.size / 1024 / 1024).toFixed(2)}MB`,
        chunks: transcriptionResult.chunks,
        transcriptionLength: transcriptionResult.text.length,
        diarization: 'Análise Inteligente com OpenAI',
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

// Endpoints de saúde e raiz (mantendo iguais...)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features: {
      openai_whisper: !!process.env.TRANSCRIPTION_API_KEY,
      intelligent_diarization: true,
      chatgpt_enhancement: !!process.env.TRANSCRIPTION_API_KEY
    }
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'BMZ - Servidor com Separação Inteligente por Pessoa!',
    version: '4.0.0',
    features: ['Video upload', 'Audio conversion', 'Intelligent speaker separation', 'OpenAI Whisper + ChatGPT'],
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
  console.log(`🚀 BMZ Backend v4.0 com Separação Inteligente`);
  console.log(`🎥 Suporte a vídeos grandes`);
  console.log(`🤖 OpenAI Whisper + ChatGPT para organização`);
  console.log(`👥 Separação por pessoa sem limite de uso`);
});