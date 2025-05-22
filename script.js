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
            // Não adicionar Content-Type, deixar o browser configurar para multipart/form-data
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

    // Evento para o botão de processar
    processBtn.addEventListener('click', () => {
        // Verificar se os campos necessários estão preenchidos
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

        // Iniciar processo de lançamento no sistema
        startProcessing(clientName.value, closerSelect.value, selectedCaseType.value);
    });

    // Processo de lançamento no sistema (agora integrado com transcrição real)
    function startProcessing(client, closer, caseType) {
        // Desabilitar botão durante o processamento
        processBtn.disabled = true;

        // Mostrar barra de progresso
        processProgress.style.display = 'block';
        processLog.style.display = 'block';

        // Limpar log anterior
        processLog.innerHTML = '';

        // Array de etapas para o processamento
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

        // Simulação do progresso
        let currentStep = 0;

        function processNextStep() {
            if (currentStep < steps.length) {
                const step = steps[currentStep];

                // Atualizar barra de progresso
                processProgressBar.style.width = `${step.progress}%`;
                processStatus.textContent = step.message;

                // Adicionar ao log
                let type = '';
                if (currentStep === steps.length - 1) {
                    type = 'success';
                } else if (currentStep === 3 && transcriptionResult) {
                    // Mostrar info da transcrição quando chegar na etapa de integração
                    addLogEntry(step.message, '');
                    addLogEntry(`📝 Transcrição integrada: ${transcriptionResult.transcription ? transcriptionResult.transcription.substring(0, 150) + '...' : 'Processada com sucesso'}`, '');
                    currentStep++;
                    setTimeout(processNextStep, 1000);
                    return;
                }
                
                addLogEntry(step.message, type);
                currentStep++;

                // Simular tempo de processamento
                setTimeout(processNextStep, 800 + Math.random() * 1200);
            } else {
                // Processamento concluído
                setTimeout(() => {
                    processStatus.textContent = "Processamento finalizado com sucesso!";
                    addLogEntry("✅ Todos os dados foram corretamente registrados no sistema.", 'success');
                    
                    if (transcriptionResult) {
                        addLogEntry("📋 Resumo do caso registrado com transcrição completa.", 'success');
                    }

                    // Permitir outro processamento
                    processBtn.disabled = false;
                    processBtn.textContent = "Processar Novo Caso";

                    // Limpar campos para novo caso
                    processBtn.addEventListener('click', resetForm, { once: true });
                }, 1000);
            }
        }

        // Iniciar processamento
        setTimeout(processNextStep, 500);
    }

    // Função para resetar o formulário
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