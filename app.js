class MarketingAgentApp {
    constructor() {
        this.chatHistory = document.getElementById('chatHistory');
        this.userInput = document.getElementById('userInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.pipelineSteps = document.querySelectorAll('.pipeline-step');
        this.scoreDisplay = document.getElementById('scoreDisplay');

        this.modal = document.getElementById('scoreModal');
        this.scoreHistoryBtn = document.getElementById('scoreHistoryBtn');
        this.closeModalBtn = document.getElementById('closeModalBtn');

        // Mobile elements
        this.mobileTabs = document.getElementById('mobileTabs');
        this.chatPanel = document.querySelector('.chat-panel');
        this.pipelinePanel = document.querySelector('.pipeline-panel');
        this.pipelineBadge = document.getElementById('pipelineBadge');
        this.activePanel = 'chat';

        this.isProcessing = false;
        this.agentOutputs = {};
        this.agentTimers = {};
        this.sseBuffer = '';

        this.initViewportHeight();
        this.initEventListeners();
        this.initMobileLayout();
    }

    initViewportHeight() {
        const updateHeight = () => {
            const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            document.documentElement.style.setProperty('--app-height', `${h}px`);
        };
        updateHeight();
        window.addEventListener('resize', updateHeight);
        window.addEventListener('orientationchange', () => setTimeout(updateHeight, 200));
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateHeight);
        }
    }

    initEventListeners() {
        this.sendBtn.addEventListener('click', () => this.handleSend());
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });

        this.userInput.addEventListener('input', () => {
            this.sendBtn.disabled = this.userInput.value.trim() === '' || this.isProcessing;
            // Auto-resize textarea
            this.userInput.style.height = 'auto';
            this.userInput.style.height = Math.min(this.userInput.scrollHeight, 160) + 'px';
        });

        this.scoreHistoryBtn.addEventListener('click', () => this.showScoreHistory());
        this.closeModalBtn.addEventListener('click', () => {
            this.modal.classList.add('hidden');
        });

        // Close modal on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.modal.classList.add('hidden');
        });

        // Expand/collapse pipeline steps
        this.pipelineSteps.forEach(step => {
            const header = step.querySelector('.step-header');
            header.addEventListener('click', () => {
                if (step.classList.contains('completed') || step.classList.contains('active')) {
                    const content = step.querySelector('.step-content');
                    if (content.style.maxHeight && content.style.maxHeight !== '0px') {
                        content.style.maxHeight = '0px';
                        content.style.padding = '0 20px';
                    } else {
                        content.style.maxHeight = '500px';
                        content.style.padding = '0 20px 20px 20px';
                    }
                }
            });
        });

        // Interactive 3D Perspective Tilt Physics (Planet Jumping Inspired)
        const tiltRig = document.getElementById('tiltRig');
        const backdropText = document.getElementById('backdropText');
        this.is3DActive = true;

        window.addEventListener('mousemove', (e) => {
            if (!this.is3DActive || window.innerWidth < 980 || !tiltRig) return;
            const x = (e.clientX / window.innerWidth) - 0.5;
            const y = (e.clientY / window.innerHeight) - 0.5;

            const rx = -y * 14;
            const ry = x * 18;

            tiltRig.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
            if (backdropText) {
                backdropText.style.transform = `translate(calc(-50% + ${-x * 35}px), calc(-50% + ${-y * 20}px))`;
            }
        });

        window.addEventListener('mouseleave', () => {
            if (tiltRig) {
                tiltRig.style.transform = 'rotateX(0deg) rotateY(0deg)';
            }
        });

        // Interactive mode toggle
        const interactiveToggle = document.getElementById('interactiveToggle');
        if (interactiveToggle) {
            interactiveToggle.addEventListener('click', () => {
                this.is3DActive = !this.is3DActive;
                document.body.classList.toggle('mode-3d-off', !this.is3DActive);
                if (!this.is3DActive && tiltRig) {
                    tiltRig.style.transform = 'rotateX(0deg) rotateY(0deg)';
                    if (backdropText) backdropText.style.transform = 'translate(-50%, -50%)';
                }
            });
        }

        // Peach Rotary Dial Interaction
        const peachDial = document.getElementById('peachDial');
        let dialRot = 0;
        if (peachDial) {
            peachDial.addEventListener('click', () => {
                dialRot += 45;
                peachDial.style.transform = `rotate(${dialRot}deg) scale(1.1)`;
                setTimeout(() => {
                    peachDial.style.transform = `rotate(${dialRot}deg) scale(1)`;
                }, 200);
            });
        }

        // Quick Idea Starter Chips
        document.querySelectorAll('.starter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const prompt = chip.getAttribute('data-prompt');
                if (prompt) {
                    this.userInput.value = prompt;
                    this.userInput.style.height = 'auto';
                    this.userInput.style.height = Math.min(this.userInput.scrollHeight, 160) + 'px';
                    this.sendBtn.disabled = false;
                    this.userInput.focus();
                }
            });
        });
    }

    async handleSend() {
        const text = this.userInput.value.trim();
        if (!text || this.isProcessing) return;

        this.addUserMessage(text);
        this.userInput.value = '';
        this.userInput.style.height = 'auto';
        this.sendBtn.disabled = true;
        this.isProcessing = true;
        this.agentOutputs = {};
        this.sseBuffer = '';

        this.resetPipeline();

        // Update pipeline tab badge to active
        if (this.pipelineBadge) {
            this.pipelineBadge.className = 'tab-badge active';
        }

        // On mobile, switch to pipeline tab once so user sees agents starting
        if (this.isMobile()) {
            this.switchPanel('pipeline');
        }

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                this.sseBuffer += decoder.decode(value, { stream: true });

                // Split on double newlines (SSE event separator)
                const events = this.sseBuffer.split('\n\n');
                this.sseBuffer = events.pop(); // Keep incomplete event in buffer

                for (const block of events) {
                    if (!block.trim()) continue;
                    this.parseSSEBlock(block);
                }
            }
        } catch (error) {
            console.error('Pipeline error:', error);
            this.addAgentMessage(`<div class="error-message">⚠️ Connection error: ${this.escapeHtml(error.message)}<br>Make sure the server is running on <code>http://localhost:8000</code></div>`);
            this.isProcessing = false;
            this.sendBtn.disabled = this.userInput.value.trim() === '';
            if (this.pipelineBadge) {
                this.pipelineBadge.className = 'tab-badge';
            }
        }
    }

    parseSSEBlock(block) {
        const lines = block.split('\n');
        let eventType = 'message';
        let dataStr = '';

        for (const line of lines) {
            if (line.startsWith('event:')) {
                eventType = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
                dataStr = line.substring(5).trim();
            }
        }

        if (!dataStr) return;

        try {
            const data = JSON.parse(dataStr);
            this.handleEvent(eventType, data);
        } catch (e) {
            console.error('Error parsing SSE data:', e, dataStr);
        }
    }

    handleEvent(event, data) {
        switch (event) {
            case 'workflow_step':
                this.handleWorkflowStep(data);
                break;
            case 'agent_chunk':
                this.handleAgentChunk(data);
                break;
            case 'agent_complete':
                this.handleAgentComplete(data);
                break;
            case 'rework':
                this.handleRework(data);
                break;
            case 'score':
                this.handleScore(data);
                break;
            case 'done':
                this.handleDone(data);
                break;
            case 'keepalive':
                // ignore
                break;
            default:
                console.log('Unknown event:', event, data);
        }
    }

    // --- Map backend agent names to frontend data-agent attributes ---
    mapAgentToStep(agentName) {
        // The backend sends "manager" for both planning and review phases.
        // We differentiate based on context/status.
        const mapping = {
            'researcher': 'researcher',
            'copywriter': 'copywriter',
            'planner': 'planner',
            'manager': null, // handled specially
            'system': null
        };
        return mapping[agentName] || agentName;
    }

    getManagerStep(message) {
        // Determine if the manager event is planning or reviewing
        if (!message) return 'manager-plan';
        const msg = message.toLowerCase();
        if (msg.includes('review') || msg.includes('scor')) {
            return 'manager-review';
        }
        return 'manager-plan';
    }

    resolveStepId(agentName, message) {
        if (agentName === 'manager') {
            return this.getManagerStep(message);
        }
        return this.mapAgentToStep(agentName);
    }

    // --- Event Handlers ---

    handleWorkflowStep(data) {
        const agent = data.agent;
        const status = data.status || 'active';
        const message = data.message || '';
        const stepId = this.resolveStepId(agent, message);

        if (!stepId) return;

        this.updatePipelineStep(stepId, status, message);

        // Start timer for this step
        if (status === 'active' && !this.agentTimers[stepId]) {
            this.agentTimers[stepId] = Date.now();
        }
    }

    handleAgentChunk(data) {
        const agent = data.agent;
        const delta = data.delta || '';

        // Determine which pipeline step this belongs to
        let stepId;
        if (agent === 'manager') {
            // Check if manager-review is active
            const reviewStep = document.querySelector('.pipeline-step[data-agent="manager-review"]');
            if (reviewStep && (reviewStep.classList.contains('active') || reviewStep.classList.contains('completed'))) {
                stepId = 'manager-review';
            } else {
                stepId = 'manager-plan';
            }
        } else {
            stepId = this.mapAgentToStep(agent);
        }

        if (!stepId) return;

        // Accumulate output
        if (!this.agentOutputs[stepId]) this.agentOutputs[stepId] = '';
        this.agentOutputs[stepId] += delta;

        this.appendAgentChunk(stepId, delta);
    }

    handleAgentComplete(data) {
        const agent = data.agent;
        const content = data.content || '';

        let stepId;
        if (agent === 'manager') {
            const reviewStep = document.querySelector('.pipeline-step[data-agent="manager-review"]');
            if (reviewStep && (reviewStep.classList.contains('active') || reviewStep.classList.contains('completed'))) {
                stepId = 'manager-review';
            } else {
                stepId = 'manager-plan';
            }
        } else {
            stepId = this.mapAgentToStep(agent);
        }

        if (!stepId) return;

        // Store the final content
        this.agentOutputs[stepId] = content;

        // Update elapsed time
        if (this.agentTimers[stepId]) {
            const elapsed = ((Date.now() - this.agentTimers[stepId]) / 1000).toFixed(1);
            const step = document.querySelector(`.pipeline-step[data-agent="${stepId}"]`);
            if (step) {
                const timeEl = step.querySelector('.step-time');
                timeEl.textContent = `${elapsed}s`;
            }
            delete this.agentTimers[stepId];
        }

        this.completeAgentStep(stepId, content);
    }

    handleRework(data) {
        const agent = data.agent;
        const feedback = data.feedback || '';
        const attempt = data.attempt || 1;

        const stepId = this.mapAgentToStep(agent) || agent;

        this.updatePipelineStep(stepId, 'reworking', `Rework #${attempt}: ${feedback}`);

        // Also show rework notification in chat
        this.addAgentMessage(`
            <div style="color: var(--score-fair); border-left: 3px solid var(--score-fair); padding-left: 12px;">
                <strong>🔄 Rework requested for ${agent}</strong> (Attempt ${attempt}/2)<br>
                <em>${this.escapeHtml(feedback)}</em>
            </div>
        `);
    }

    handleScore(data) {
        const score = data.score || 0;
        const reasoning = data.reasoning || '';
        const previousBest = data.previous_best || 0;
        const breakdown = data.breakdown || {};
        const reworkCount = data.rework_count || 0;

        this.showScore(score, reasoning, previousBest, breakdown, reworkCount);
    }

    handleDone(data) {
        // Build final response for chat from all agent outputs
        let finalHtml = '<div class="final-output">';
        finalHtml += '<h2 style="margin-bottom: 16px; color: var(--text-primary);">📋 Marketing Campaign Output</h2>';

        if (this.agentOutputs['researcher']) {
            finalHtml += `<details style="margin-bottom: 16px;"><summary style="cursor:pointer; font-weight:600; color: var(--researcher-color);">🔍 Research Report</summary><div style="margin-top:8px;">${marked.parse(this.agentOutputs['researcher'])}</div></details>`;
        }
        if (this.agentOutputs['copywriter']) {
            finalHtml += `<div style="margin-bottom: 16px; padding: 16px; background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.15); border-radius: 12px;"><h3 style="color: var(--copywriter-color); margin-bottom: 8px;">✍️ Content</h3>${marked.parse(this.agentOutputs['copywriter'])}</div>`;
        }
        if (this.agentOutputs['planner']) {
            finalHtml += `<div style="margin-bottom: 16px; padding: 16px; background: rgba(245,158,11,0.05); border: 1px solid rgba(245,158,11,0.15); border-radius: 12px;"><h3 style="color: var(--planner-color); margin-bottom: 8px;">📋 Posting Plan</h3>${marked.parse(this.agentOutputs['planner'])}</div>`;
        }

        finalHtml += '</div>';

        // On mobile, switch to chat panel first so dimensions are resolved
        if (this.isMobile()) {
            this.switchPanel('chat');
        }

        this.addAgentMessage(finalHtml);

        this.isProcessing = false;
        this.sendBtn.disabled = this.userInput.value.trim() === '';

        if (this.pipelineBadge) {
            this.pipelineBadge.className = 'tab-badge done';
        }

        // Guarantee that the final message is scrolled into view and fully readable
        this.forceScrollToBottom();
        setTimeout(() => {
            this.forceScrollToBottom();
        }, 150);
    }

    // --- UI Update Functions ---

    addUserMessage(text) {
        const msg = document.createElement('div');
        msg.className = 'chat-message user';
        msg.innerHTML = `<div class="message-content"><p>${this.escapeHtml(text)}</p></div>`;
        this.chatHistory.appendChild(msg);
        this.forceScrollToBottom();
    }

    addAgentMessage(html) {
        const msg = document.createElement('div');
        msg.className = 'chat-message agent';
        msg.innerHTML = `<div class="message-content markdown-output">${html}</div>`;
        this.chatHistory.appendChild(msg);
        this.forceScrollToBottom();
    }

    updatePipelineStep(stepId, status, message) {
        const step = document.querySelector(`.pipeline-step[data-agent="${stepId}"]`);
        if (!step) return;

        step.className = `pipeline-step ${status}`;
        const statusSpan = step.querySelector('.step-status');

        const statusLabels = {
            'idle': 'Idle',
            'active': '● Working',
            'completed': '✓ Done',
            'reworking': '↻ Reworking',
            'error': '✗ Error'
        };
        statusSpan.textContent = statusLabels[status] || status;

        if (status === 'active' || status === 'reworking') {
            const content = step.querySelector('.step-content');
            content.style.maxHeight = '500px';
            content.style.padding = '0 20px 20px 20px';

            // Reset streaming text for rework
            if (status === 'reworking') {
                const streamContainer = step.querySelector('.streaming-text');
                streamContainer.textContent = `⚠️ ${message || 'Reworking...'}\n\n`;
                streamContainer.style.display = 'block';
                const mdContainer = step.querySelector('.markdown-output');
                mdContainer.style.display = 'none';
            }

            step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    appendAgentChunk(stepId, chunk) {
        const step = document.querySelector(`.pipeline-step[data-agent="${stepId}"]`);
        if (!step) return;

        const streamContainer = step.querySelector('.streaming-text');
        streamContainer.textContent += chunk;

        const content = step.querySelector('.step-content');
        content.scrollTop = content.scrollHeight;
    }

    completeAgentStep(stepId, output) {
        const step = document.querySelector(`.pipeline-step[data-agent="${stepId}"]`);
        if (!step) return;

        this.updatePipelineStep(stepId, 'completed');

        const streamContainer = step.querySelector('.streaming-text');
        streamContainer.style.display = 'none';

        const mdContainer = step.querySelector('.markdown-output');
        try {
            mdContainer.innerHTML = marked.parse(output || '');
        } catch (e) {
            mdContainer.textContent = output || '';
        }
        mdContainer.style.display = 'block';

        // Keep content scrollable and accessible
        const content = step.querySelector('.step-content');
        content.style.maxHeight = '340px';
    }

    showScore(score, reasoning, previousBest, breakdown, reworkCount) {
        const defaultMetrics = document.getElementById('hudDefaultMetrics');
        if (defaultMetrics) defaultMetrics.style.display = 'none';

        this.scoreDisplay.classList.remove('hidden');
        setTimeout(() => {
            this.scoreDisplay.classList.add('visible');

            const gaugeProgress = this.scoreDisplay.querySelector('.gauge-progress');
            const scoreValue = this.scoreDisplay.querySelector('.score-value');
            const reasoningContainer = this.scoreDisplay.querySelector('.score-reasoning');

            // Animate number counting up
            let currentScore = 0;
            const targetScore = Math.min(Math.max(score, 0), 100);
            const interval = setInterval(() => {
                if (currentScore >= targetScore) {
                    clearInterval(interval);
                    scoreValue.textContent = targetScore;
                } else {
                    currentScore++;
                    scoreValue.textContent = currentScore;
                }
            }, 20);

            // Animate SVG gauge
            const maxOffset = 283; // 2 * π * 45
            const offset = maxOffset - (targetScore / 100) * maxOffset;
            gaugeProgress.style.strokeDashoffset = offset;

            // Set color based on score
            let color = 'var(--score-excellent)';
            if (targetScore < 80) color = 'var(--score-good)';
            if (targetScore < 60) color = 'var(--score-fair)';
            if (targetScore < 40) color = 'var(--score-poor)';
            gaugeProgress.style.stroke = color;
            scoreValue.style.color = color;

            // Build reasoning HTML with breakdown
            let reasoningHtml = '';
            if (previousBest > 0) {
                const diff = targetScore - previousBest;
                const arrow = diff >= 0 ? '↑' : '↓';
                const diffColor = diff >= 0 ? 'var(--score-excellent)' : 'var(--score-poor)';
                reasoningHtml += `<div style="text-align:center; margin-bottom:12px; font-size:0.9rem; color: var(--text-secondary);">Previous best: <strong>${previousBest}</strong> <span style="color:${diffColor}">${arrow} ${Math.abs(diff)}</span></div>`;
            }
            if (reworkCount > 0) {
                reasoningHtml += `<div style="text-align:center; margin-bottom:12px; font-size:0.85rem; color: var(--score-fair);">🔄 ${reworkCount} rework cycle${reworkCount > 1 ? 's' : ''} needed</div>`;
            }
            if (breakdown && Object.keys(breakdown).length > 0) {
                reasoningHtml += '<div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom:12px;">';
                const labels = {
                    content_quality: '📝 Quality',
                    brand_alignment: '🎨 Brand',
                    platform_optimization: '📱 Platform',
                    conversion_potential: '🎯 Conversion'
                };
                for (const [key, label] of Object.entries(labels)) {
                    const val = breakdown[key] || 0;
                    reasoningHtml += `<div style="background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px; font-size:0.85rem;"><span style="color:var(--text-muted)">${label}</span><br><strong>${val}</strong>/25</div>`;
                }
                reasoningHtml += '</div>';
            }
            try {
                reasoningHtml += marked.parse(reasoning || '');
            } catch {
                reasoningHtml += `<p>${reasoning || ''}</p>`;
            }
            reasoningContainer.innerHTML = reasoningHtml;
        }, 100);
    }

    resetPipeline() {
        const defaultMetrics = document.getElementById('hudDefaultMetrics');
        if (defaultMetrics) defaultMetrics.style.display = 'block';

        this.scoreDisplay.classList.remove('visible');
        setTimeout(() => {
            this.scoreDisplay.classList.add('hidden');
        }, 600);

        if (this.pipelineBadge) {
            this.pipelineBadge.className = 'tab-badge';
        }

        this.pipelineSteps.forEach(step => {
            step.className = 'pipeline-step idle';
            step.querySelector('.step-status').textContent = 'Idle';
            step.querySelector('.step-time').textContent = '';
            step.querySelector('.streaming-text').textContent = '';
            step.querySelector('.streaming-text').style.display = 'block';
            step.querySelector('.markdown-output').innerHTML = '';
            step.querySelector('.markdown-output').style.display = 'none';
            step.querySelector('.step-content').style.maxHeight = null;
            step.querySelector('.step-content').style.padding = '0 20px';
        });

        this.agentTimers = {};
    }

    // --- Mobile Layout ---

    isMobile() {
        return window.innerWidth <= 860;
    }

    initMobileLayout() {
        // Set up mobile tab click handlers
        if (this.mobileTabs) {
            const tabs = this.mobileTabs.querySelectorAll('.mobile-tab');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const panel = tab.dataset.panel;
                    this.switchPanel(panel);
                });
            });
        }

        // Apply initial state
        this.applyMobileState();

        // Listen for resize to toggle mobile/desktop
        window.addEventListener('resize', () => {
            this.applyMobileState();
        });
    }

    applyMobileState() {
        if (this.isMobile()) {
            this.switchPanel(this.activePanel);
        } else {
            // Desktop: ensure both panels are visible
            this.chatPanel.classList.remove('mobile-hidden');
            this.pipelinePanel.classList.remove('mobile-hidden');
        }
    }

    switchPanel(panelName) {
        this.activePanel = panelName;

        // Update tabs
        if (this.mobileTabs) {
            const tabs = this.mobileTabs.querySelectorAll('.mobile-tab');
            tabs.forEach(tab => {
                tab.classList.toggle('active', tab.dataset.panel === panelName);
            });
        }

        // Show/hide panels
        if (panelName === 'chat') {
            this.chatPanel.classList.remove('mobile-hidden');
            this.pipelinePanel.classList.add('mobile-hidden');
            // Give browser frame to compute layout, then scroll to latest content
            setTimeout(() => {
                this.forceScrollToBottom();
            }, 60);
        } else {
            this.chatPanel.classList.add('mobile-hidden');
            this.pipelinePanel.classList.remove('mobile-hidden');
        }
    }

    autoSwitchToPipeline() {
        if (this.isMobile() && this.activePanel === 'chat') {
            this.switchPanel('pipeline');
        }
    }

    autoSwitchToChat() {
        if (this.isMobile() && this.activePanel === 'pipeline') {
            this.switchPanel('chat');
        }
    }

    forceScrollToBottom() {
        if (!this.chatHistory) return;
        requestAnimationFrame(() => {
            this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
        });
        setTimeout(() => {
            if (this.chatHistory) {
                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
            }
        }, 80);
        setTimeout(() => {
            if (this.chatHistory) {
                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
            }
        }, 250);
    }

    scrollToBottom(force = false) {
        if (!this.chatHistory) return;
        if (force) {
            this.forceScrollToBottom();
            return;
        }
        // Auto-scroll if user is near bottom
        const distFromBottom = this.chatHistory.scrollHeight - this.chatHistory.scrollTop - this.chatHistory.clientHeight;
        if (distFromBottom < 300) {
            requestAnimationFrame(() => {
                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
            });
        }
    }

    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async showScoreHistory() {
        this.modal.classList.remove('hidden');
        const tbody = document.getElementById('historyTableBody');

        try {
            const res = await fetch('/api/history');
            if (!res.ok) throw new Error('No history API');
            const data = await res.json();

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:32px;">No history yet. Run your first marketing campaign!</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(row => `
                <tr>
                    <td>${row.timestamp ? new Date(row.timestamp).toLocaleDateString() : 'N/A'}</td>
                    <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(row.request || '')}">${this.escapeHtml(row.request || 'N/A')}</td>
                    <td style="font-weight: bold; color: ${this.getScoreColor(row.score || 0)}">${row.score || 0}/100</td>
                    <td>${row.rework_count || 0}</td>
                </tr>
            `).join('');
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:32px;">Could not load history. Make sure the server is running.</td></tr>';
        }
    }

    getScoreColor(score) {
        if (score >= 80) return 'var(--score-excellent)';
        if (score >= 60) return 'var(--score-good)';
        if (score >= 40) return 'var(--score-fair)';
        return 'var(--score-poor)';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MarketingAgentApp();
});
