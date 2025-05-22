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

// Função para separar falas usando padrões específicos de conversas jurídicas
function separateSpeakersByPatterns(transcriptionText) {
  console.log('Separando falas por padrões específicos...');
  
  // Padrões que indicam mudança de pessoa
  const patterns = [
    // Advogado fazendo perguntas
    { 
      regex: /(ok\.?\s+|certo\.?\s+|então\.?\s+|agora\.?\s+)?((só )?para confirmar|vamos confirmar|me confirma|confirma pra mim|você pode confirmar)/i,
      speaker: 'Advogado(a)'
    },
    {
      regex: /(qual|como|quando|onde|por que|quantos?|que tipo)/i,
      speaker: 'Advogado(a)'
    },
    {
      regex: /(a senhora|o senhor|você).+(recebe|tem|fez|trabalhou|está)/i,
      speaker: 'Advogado(a)'
    },
    // Cliente respondendo
    {
      regex: /^(sim|não|isso|exato|correto|é|ah|bom|então)[\s\.,]/i,
      speaker: 'Cliente'
    },
    {
      regex: /(eu|meu|minha|meus|minhas).+(trabalho|recebo|tenho|fiz|sou|era)/i,
      speaker: 'Cliente'
    },
    {
      regex: /(aposentadoria|pensão|benefício|inss|hospital|médico|cirurgia|tratamento)/i,
      speaker: 'Cliente'
    }
  ];

  // Dividir texto em sentenças
  const sentences = transcriptionText
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  let organized = '';
  let currentSpeaker = null;
  let speakerCounts = { 'Advogado(a)': 0, 'Cliente': 0 };
  
  sentences.forEach((sentence, index) => {
    let detectedSpeaker = null;
    
    // Verificar padrões para identificar o falante
    for (const pattern of patterns) {
      if (pattern.regex.test(sentence)) {
        detectedSpeaker = pattern.speaker;
        break;
      }
    }
    
    // Se não detectou padrão específico, usar lógica contextual
    if (!detectedSpeaker) {
      // Se a sentença anterior foi uma pergunta (advogado), essa provavelmente é resposta (cliente)
      if (index > 0 && sentences[index - 1].includes('?')) {
        detectedSpeaker = 'Cliente';
      }
      // Se contém primeira pessoa, provavelmente é cliente
      else if (/(^|\s)(eu|meu|minha|meus|minhas)\s/i.test(sentence)) {
        detectedSpeaker = 'Cliente';
      }
      // Se contém segunda pessoa, provavelmente é advogado
      else if (/(^|\s)(você|senhor|senhora|seu|sua)\s/i.test(sentence)) {
        detectedSpeaker = 'Advogado(a)';
      }
      // Alternar entre os dois se não conseguir identificar
      else {
        detectedSpeaker = speakerCounts['Advogado(a)'] <= speakerCounts['Cliente'] ? 'Advogado(a)' : 'Cliente';
      }
    }
    
    // Adicionar mudança de falante se necessário
    if (detectedSpeaker !== currentSpeaker) {
      if (organized.length > 0) organized += '\n\n';
      organized += `**${detectedSpeaker}:**\n`;
      currentSpeaker = detectedSpeaker;
      speakerCounts[detectedSpeaker]++;
    }
    
    organized += sentence.trim() + '. ';
  });
  
  return organized.trim();
}

// Função alternativa usando ChatGPT como backup
async function separateSpeakersWithChatGPT(transcriptionText, apiKey) {
  console.log('Tentando separação com ChatGPT...');
  
  try {
    // Usar apenas os primeiros 2000 caracteres para não exceder limites
    const textToAnalyze = transcriptionText.substring(0, 2000);
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Você é um assistente que organiza transcrições de entrevistas jurídicas. Separe as falas entre Advogado(a) e Cliente usando o formato "**Advogado(a):**" e "**Cliente:**". Identifique quem fala baseado no contexto: advogados fazem perguntas e clientes respondem sobre sua vida pessoal.'
        },
        {
          role: 'user',
          content: `Organize esta transcrição separando as falas:\n\n${textToAnalyze}`
        }
      ],
      max_tokens: 1000,
      temperature: 0.1
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (response.data.choices && response.data.choices[0]) {
      const organizedPart = response.data.choices[0].message.content;
      
      // Se o ChatGPT funcionou, usar o resultado + aplicar nos resto do texto
      if (organizedPart.includes('**Advogado(a):**') || organizedPart.includes('**Cliente:**')) {
        console.log('ChatGPT funcionou, aplicando padrões ao resto...');
        
        // Aplicar padrões no resto do texto se for maior
        if (transcriptionText.length > 2000) {
          const remainingText = transcriptionText.substring(2000);
          const remainingOrganized = separateSpeakersByPatterns(remainingText);
          return organizedPart + '\n\n' + remainingOrganized;
        }
        
        return organizedPart;
      }
    }
  } catch (error) {
    console.log('ChatGPT falhou, usando padrões:', error.message);
  }
  
  // Se ChatGPT falhar, usar padrões
  return separateSpeakersByPatterns(transcriptionText);
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

    // Etapa 3: Separar falas (tentativa com ChatGPT + padrões como backup)
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
      method: 'OpenAI Whisper + Padrões Específicos + ChatGPT'
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
  console.log('=== INICIANDO PROCESSAMENTO COM SEPARAÇÃO FORÇADA ===');
  
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

    // Etapa 2: Transcrever com separação forçada de falas
    console.log('=== ETAPA 2: Transcrevendo com separação forçada ===');
    const transcriptionResult = await transcribeWithSpeakerSeparation(audioPath, apiKey);

    console.log('=== ETAPA 3: Finalizando ===');
    console.log(`Transcrição organizada: ${transcriptionResult.organized.length} caracteres`);

    // Limpar arquivos temporários
    const filesToClean = [videoPath, audioPath];
    setTimeout(() => cleanupFiles(filesToClean), 5000);

    res.status(200).json({
      message: 'Vídeo processado com separação forçada de falas!',
      transcription: transcriptionResult.text,
      organized_transcription: transcriptionResult.organized,
      stats: {
        originalSize: `${(req.file.size / 1024 / 1024).toFixed(2)}MB`,
        audioSize: `${(audioStats.size / 1024 / 1024).toFixed(2)}MB`,
        chunks: transcriptionResult.chunks,
        transcriptionLength: transcriptionResult.text.length,
        organizedLength: transcriptionResult.organized.length,
        diarization: 'Padrões Específicos + ChatGPT',
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
      pattern_based_separation: true,
      chatgpt_backup: !!process.env.TRANSCRIPTION_API_KEY
    }
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'BMZ - Servidor com Separação FORÇADA de Falas!',
    version: '6.0.0',
    features: ['Video upload', 'Audio conversion', 'Forced speaker separation', 'Legal interview patterns'],
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
  console.log(`🚀 BMZ Backend v6.0 com Separação FORÇADA`);
  console.log(`🎥 Suporte a vídeos grandes`);
  console.log(`🎙️ Whisper para transcrição`);
  console.log(`⚖️ Padrões específicos para conversas jurídicas`);
  console.log(`🤖 ChatGPT como backup`);
});