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
    const closerInput = document.getElementById('closer-name');
    const selectSelected = document.getElementById('select-selected');
    const selectItems = document.getElementById('select-items');
    const caseTypeRadios = document.querySelectorAll('input[name="case-type"]');

    // Lista de closers para popular o select customizado
    const closersList = [
        "João Silva",
        "Maria Souza",
        "Carlos Oliveira",
        "Ana Paula",
        "Roberto Lima"
    ];

    // Popular o dropdown customizado
    closersList.forEach(closer => {
        const option = document.createElement('div');
        option.textContent = closer;
        option.addEventListener('click', function() {
            closerInput.value = this.textContent;
            selectSelected.textContent = this.textContent;
            
            // Remover classe "same-as-selected" de todos os itens
            const items = selectItems.getElementsByTagName('div');
            for (let i = 0; i < items.length; i++) {
                items[i].classList.remove('same-as-selected');
            }
            
            // Adicionar classe ao item selecionado
            this.classList.add('same-as-selected');
            
            // Fechar dropdown
            selectSelected.click();
            
            // Verificar validade do formulário
            checkFormValidity();
        });
        selectItems.appendChild(option);
    });

    // Toggle dropdown ao clicar no select
    selectSelected.addEventListener('click', function(e) {
        e.stopPropagation();
        this.classList.toggle('select-arrow-active');
        selectItems.classList.toggle('select-hide');
        selectItems.classList.toggle('select-show');
    });

    // Fechar todos os select boxes quando clicar fora
    document.addEventListener('click', function() {
        selectSelected.classList.remove('select-arrow-active');
        selectItems.classList.add('select-hide');
        selectItems.classList.remove('select-show');
    });

    // Adicionando função para mensagem de log
    window.addLogEntry = function(message, type = '') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = message;
        processLog.appendChild(entry);
        processLog.scrollTop = processLog.scrollHeight;
    }

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
        const closerNameValid = closerInput.value.trim() !== '';
        const caseTypeValid = Array.from(caseTypeRadios).some(radio => radio.checked);
        const videoValid = videoPreview.src !== '';

        processBtn.disabled = !(clientNameValid && closerNameValid && caseTypeValid && videoValid);
    }

    // Evento para campos de texto
    clientName.addEventListener('input', checkFormValidity);

    // Evento para botões de rádio
    caseTypeRadios.forEach(radio => {
        radio.addEventListener('change', checkFormValidity);
    });

    // Função para lidar com o upload de vídeo
    function handleVideoUpload() {
        const file = fileInput.files[0];
        if (!file) return;

        // Verificar se é um arquivo de vídeo
        if (!file.type.includes('video/')) {
            alert('Por favor, selecione um arquivo de vídeo válido');
            return;
        }

        // Criar URL para o vídeo
        const videoURL = URL.createObjectURL(file);
        videoPreview.src = videoURL;
        videoPreview.style.display = 'block';

        // Enviar o vídeo para o backend para conversão e transcrição
        const formData = new FormData();
        formData.append('video', file);

        fetch('https://teu-backend.onrender.com/upload', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            console.log('Transcrição enviada:', data);
            addLogEntry("Áudio enviado para transcrição com sucesso!", 'success');
        })
        .catch(err => {
            console.error('Erro no envio para transcrição:', err);
            addLogEntry("Erro ao enviar áudio para transcrição.", 'error');
        });

        // Atualizar UI
        uploadArea.innerHTML = `
            <div id="upload-icon">✓</div>
            <p>${file.name}</p>
            <p class="info-text">Clique para selecionar outro vídeo</p>
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

        if (!closerInput.value.trim()) {
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
        startProcessing(clientName.value, closerInput.value, selectedCaseType.value);
    });

    // Simulação de processamento do caso
    function startProcessing(client, closer, caseType) {
        // Desabilitar botão durante o processamento
        processBtn.disabled = true;

        // Mostrar barra de progresso
        processProgress.style.display = 'block';
        processLog.style.display = 'block';

        // Array de etapas para simular o processamento
        const steps = [
            { message: `Iniciando processamento do caso para ${client}`, progress: 5 },
            { message: `Validando informações do cliente`, progress: 15 },
            { message: `Classificando caso como: ${caseType}`, progress: 25 },
            { message: `Extraindo dados do vídeo`, progress: 40 },
            { message: `Processando depoimento`, progress: 55 },
            { message: `Gerando documentação`, progress: 70 },
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
                }
                addLogEntry(step.message, type);

                currentStep++;

                // Simular tempo de processamento
                setTimeout(processNextStep, 800 + Math.random() * 1200);
            } else {
                // Processamento concluído
                setTimeout(() => {
                    processStatus.textContent = "Processamento finalizado com sucesso!";
                    addLogEntry("Todos os dados foram corretamente registrados no sistema.", 'success');

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
        closerInput.value = '';
        selectSelected.textContent = 'Selecione o closer';
        
        // Remover classe "same-as-selected" de todos os itens
        const items = selectItems.getElementsByTagName('div');
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove('same-as-selected');
        }
        
        caseTypeRadios.forEach(radio => radio.checked = false);
        videoPreview.src = '';
        videoPreview.style.display = 'none';

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