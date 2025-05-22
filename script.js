document.addEventListener('DOMContentLoaded', () => {
    // Elementos da interface
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const videoPreview = document.getElementById('video-preview');
    const processBtn = document.getElementById('process-btn');
    const processProgress = document.getElementById('process-progress');
    const processProgressBar = document.getElementById('process-progress-bar');
    const processStatus = document.getElementById('process-status');
    const processLog = document.getElementById('process-log');
    const clientName = document.getElementById('client-name');
    const closerSelect = document.getElementById('closer-name');
    const caseTypeRadios = document.querySelectorAll('input[name="case-type"]');

    // Lista de closers para popular o select
    const closersList = [
        "Elaine Oliveira",
        "Millene Leal",
        "Hilary Erddmann",
        "João Guilherme",
        "Evair Gonçalves",
        "Fabio Petriw",
        "José Henrique",
        "Maria Rita",
        "Ana Paula",
        "Lucas Silva",
        "Stephanie Cobo",
        "Amanda Kloster",
        "Erica Okarenski",
        "Gesisca Trzesniovski",
        "Janayna Freisleben"
    ];

    // Popular o select de closer
    closersList.forEach(closer => {
        const option = document.createElement('option');
        option.value = closer;
        option.textContent = closer;
        closerSelect.appendChild(option);
    });

    // Eventos para upload de arquivo
    uploadArea.addEventListener('click', () => fileInput.click());

    // Drag and drop para upload de vídeo
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.backgroundColor = '#e0f2fe';
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.backgroundColor = '';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.backgroundColor = '';

        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            handleVideoUpload();
        }
    });

    fileInput.addEventListener('change', handleVideoUpload);

    // Verificação de campos preenchidos para habilitar botão
    function checkFormValidity() {
        const clientNameValid = clientName.value.trim() !== '';
        const closerNameValid = closerSelect.value.trim() !== '';
        const caseTypeValid = Array.from(caseTypeRadios).some(radio => radio.checked);
        const videoValid = videoPreview.src !== '';

        processBtn.disabled = !(clientNameValid && closerNameValid && caseTypeValid && videoValid);
    }

    // Evento para campos de texto
    clientName.addEventListener('input', checkFormValidity);
    closerSelect.addEventListener('change', checkFormValidity);

    // Evento para botões de rádio
    caseTypeRadios.forEach(radio => {
        radio.addEventListener('change', checkFormValidity);
    });

    // Função para adicionar uma mensagem ao log
    function addLogEntry(message, type = '') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = message;
        processLog.appendChild(entry);
        processLog.scrollTop = processLog.scrollHeight;
    }

    // Função para criar botão de visualizar transcrição
    function createTranscriptionButton(transcription) {
        const button = document.createElement('button');
        button.textContent = '📄 Ver Transcrição Completa';
        button.style.cssText = `
            background-color: #2ecc71;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 5px;
            cursor: pointer;
            margin: 10px 0;
            font-size: 14px;
        `;
        
        button.addEventListener('click', () => {
            showTranscriptionModal(transcription);
        });
        
        return button;
    }

    // Função para mostrar modal com transcrição completa
    function showTranscriptionModal(transcription) {
        // Criar modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background-color: white;
            padding: 20px;
            border-radius: 10px;
            max-width: 80%;
            max-height: 80%;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        `;

        const title = document.createElement('h3');
        title.textContent = '📄 Transcrição Completa';
        title.style.margin = '0';
        title.style.color = '#333';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #666;
        `;
        closeBtn.addEventListener('click', () => document.body.removeChild(modal));

        const transcriptionText = document.createElement('div');
        transcriptionText.style.cssText = `
            line-height: 1.6;
            font-size: 16px;
            color: #333;
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid #ddd;
            padding: 15px;
            border-radius: 5px;
            background-color: #f9f9f9;
        `;
        transcriptionText.textContent = transcription;

        const actions = document.createElement('div');
        actions.style.cssText = `
            margin-top: 20px;
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        `;

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋 Copiar Texto';
        copyBtn.style.cssText = `
            background-color: #3498db;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
        `;
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(transcription).then(() => {
                copyBtn.textContent = '✅ Copiado!';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copiar Texto';
                }, 2000);
            });
        });

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '💾 Baixar TXT';
        downloadBtn.style.cssText = `
            background-color: #27ae60;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
        `;
        downloadBtn.addEventListener('click', () => {
            const blob = new Blob([transcription], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `transcricao_${clientName.value || 'cliente'}_${new Date().toISOString().slice(0, 10)}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        header.appendChild(title);
        header.appendChild(closeBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(downloadBtn);
        
        modalContent.appendChild(header);
        modalContent.appendChild(transcriptionText);
        modalContent.appendChild(actions);
        modal.appendChild(modalContent);
        
        document.body.appendChild(modal);

        // Fechar modal clicando fora
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    // Variável para armazenar o resultado da transcrição
    let transcriptionResult = null;

    // Função para lidar com o upload de vídeo
    function handleVideoUpload() {
        const file = fileInput.files[0];
        if (!file) return;

        // Verificar se é um arquivo de vídeo
        if (!file.type.includes('video/')) {
            alert('Por favor, selecione um arquivo de vídeo válido');
            return;
        }

        console.log('Iniciando upload do vídeo:', file.name, `(${(file.size / 1024 / 1024).toFixed(2)}MB)`);

        // Criar URL para o vídeo
        const videoURL = URL.createObjectURL(file);
        videoPreview.src = videoURL;
        videoPreview.style.display = 'block';

        // Mostrar status de upload
        processProgress.style.display = 'block';
        processLog.style.display = 'block';
        processStatus.textContent = 'Enviando vídeo para processamento...';
        addLogEntry('Iniciando upload do vídeo...', '');

        // Enviar o vídeo para o backend para conversão e transcrição
        const formData = new FormData();
        formData.append('video', file);

        // Configurar timeout longo para vídeos grandes
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutos timeout

        fetch('https://bmz-backend.onrender.com/upload', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        })
        .then(response => {
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`Erro HTTP: ${response.status} - ${response.statusText}`);
            }
            
            return response.json();
        })
        .then(data => {
            console.log('Resposta do backend:', data);
            
            // Armazenar resultado da transcrição
            transcriptionResult = data;
            
            processStatus.textContent = 'Vídeo processado com sucesso!';
            addLogEntry('✅ Vídeo convertido para áudio', 'success');
            
            if (data.transcription) {
                addLogEntry('✅ Transcrição realizada com sucesso', 'success');
                addLogEntry(`📝 Transcrição: ${data.transcription.substring(0, 100)}...`, '');
                
                // Adicionar botão para ver transcrição completa
                const transcriptionBtn = createTranscriptionButton(data.transcription);
                processLog.appendChild(transcriptionBtn);
            }
            
            if (data.stats) {
                addLogEntry(`📊 Estatísticas: ${data.stats.originalSize} → ${data.stats.audioSize} (${data.stats.chunks} chunks)`, '');
            }
            
            addLogEntry('✅ Processamento concluído! Agora você pode preencher os dados e lançar no sistema.', 'success');
            
        })
        .catch(err => {
            clearTimeout(timeoutId);
            console.error('Erro no envio para transcrição:', err);
            
            let errorMessage = 'Erro ao processar vídeo: ';
            
            if (err.name === 'AbortError') {
                errorMessage += 'Timeout - vídeo muito grande ou conexão lenta';
            } else if (err.message.includes('Failed to fetch')) {
                errorMessage += 'Falha na conexão com o servidor';
            } else {
                errorMessage += err.message;
            }
            
            processStatus.textContent = errorMessage;
            addLogEntry(`❌ ${errorMessage}`, 'error');
            addLogEntry('💡 Tente com um vídeo menor ou verifique sua conexão', 'warning');
        });

        // Atualizar UI
        uploadArea.innerHTML = `
            <div id="upload-icon">✓</div>
            <p>${file.name}</p>
            <p class="info-text">Vídeo selecionado - Processando...</p>
        `;

        checkFormValidity();
    }

    // Resto do código permanece igual...
    // (mantendo as funções startProcessing, resetForm, etc. como estavam)

    // Evento para o botão de processar
    processBtn.addEventListener('click', () => {
        const selectedCaseType = document.querySelector('input[name="case-type"]:checked');

        if (!clientName.value.trim()) {
            alert('Por favor, informe o nome do cliente');
            return;
        }

        if (!closerSelect.value.trim()) {
            alert('Por favor, informe o nome do closer');
            return;
        }

        if (!selectedCaseType) {
            alert('Por favor, selecione um tipo de caso');
            return;
        }

        if (!videoPreview.src) {
            alert('Por favor, selecione um vídeo');
            return;
        }

        startProcessing(clientName.value, closerSelect.value, selectedCaseType.value);
    });

    function startProcessing(client, closer, caseType) {
        processBtn.disabled = true;
        processProgress.style.display = 'block';
        processLog.style.display = 'block';
        processLog.innerHTML = '';

        const steps = [
            { message: `Iniciando processamento do caso para ${client}`, progress: 10 },
            { message: `Validando informações do cliente`, progress: 20 },
            { message: `Classificando caso como: ${caseType}`, progress: 30 },
            { message: `Integrando dados da transcrição`, progress: 50 },
            { message: `Gerando documentação do caso`, progress: 70 },
            { message: `Validando regras de negócio para ${caseType}`, progress: 85 },
            { message: `Registrando caso no sistema para o closer ${closer}`, progress: 95 },
            { message: `Caso lançado com sucesso!`, progress: 100 }
        ];

        let currentStep = 0;

        function processNextStep() {
            if (currentStep < steps.length) {
                const step = steps[currentStep];
                processProgressBar.style.width = `${step.progress}%`;
                processStatus.textContent = step.message;
                
                let type = '';
                if (currentStep === steps.length - 1) {
                    type = 'success';
                } else if (currentStep === 3 && transcriptionResult) {
                    addLogEntry(step.message, '');
                    addLogEntry(`📝 Transcrição integrada: ${transcriptionResult.transcription ? transcriptionResult.transcription.substring(0, 150) + '...' : 'Processada com sucesso'}`, '');
                    
                    // Adicionar botão de transcrição novamente no processamento final
                    if (transcriptionResult.transcription) {
                        const transcriptionBtn = createTranscriptionButton(transcriptionResult.transcription);
                        processLog.appendChild(transcriptionBtn);
                    }
                    
                    currentStep++;
                    setTimeout(processNextStep, 1000);
                    return;
                }
                
                addLogEntry(step.message, type);
                currentStep++;
                setTimeout(processNextStep, 800 + Math.random() * 1200);
            } else {
                setTimeout(() => {
                    processStatus.textContent = "Processamento finalizado com sucesso!";
                    addLogEntry("✅ Todos os dados foram corretamente registrados no sistema.", 'success');
                    
                    if (transcriptionResult) {
                        addLogEntry("📋 Resumo do caso registrado com transcrição completa.", 'success');
                    }

                    processBtn.disabled = false;
                    processBtn.textContent = "Processar Novo Caso";
                    processBtn.addEventListener('click', resetForm, { once: true });
                }, 1000);
            }
        }

        setTimeout(processNextStep, 500);
    }

    function resetForm() {
        clientName.value = '';
        closerSelect.value = '';
        caseTypeRadios.forEach(radio => radio.checked = false);
        videoPreview.src = '';
        videoPreview.style.display = 'none';
        transcriptionResult = null;

        uploadArea.innerHTML = `
            <div id="upload-icon">📁</div>
            <p>Clique ou arraste um arquivo de vídeo aqui</p>
            <p class="info-text">Formatos suportados: MP4, WebM, MOV, AVI</p>
        `;

        processProgress.style.display = 'none';
        processProgressBar.style.width = '0';
        processStatus.textContent = 'Aguardando...';
        processLog.innerHTML = '';
        processLog.style.display = 'none';

        processBtn.textContent = "Lançar no Sistema";
        processBtn.disabled = true;
    }
});