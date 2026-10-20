class MarketingAgentApp {
    constructor() {
        this.chatHistory = document.getElementById('chatHistory');
        this.userInput = document.getElementById('userInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.pipelineSteps = document.querySelectorAll('.pipeline-step');
        this.scoreDisplay = document.getElementById('scoreDisplay');

        // Score Modal elements
        this.scoreModal = document.getElementById('scoreModal');
        this.scoreHistoryBtn = document.getElementById('scoreHistoryBtn');
        this.closeModalBtn = document.getElementById('closeModalBtn');

        // Conversation Management Elements
        this.savedChatsModal = document.getElementById('savedChatsModal');
        this.savedChatsBtn = document.getElementById('savedChatsBtn');
        this.savedChatsCount = document.getElementById('savedChatsCount');
        this.savedChatsList = document.getElementById('savedChatsList');
        this.newChatBtn = document.getElementById('newChatBtn');
        this.studioNewChatBtn = document.getElementById('studioNewChatBtn');
        this.modalNewChatBtn = document.getElementById('modalNewChatBtn');
        this.closeSavedChatsModalBtn = document.getElementById('closeSavedChatsModalBtn');
        this.chatTitle = document.getElementById('chatTitle');
        this.activeChatIndicator = document.getElementById('activeChatIndicator');

        // Mobile elements
        this.mobileTabs = document.getElementById('mobileTabs');
        this.chatPanel = document.querySelector('.chat-panel');
        this.pipelinePanel = document.querySelector('.pipeline-panel');
        this.hudPanel = document.querySelector('.hud-metrics-column');
        this.pipelineBadge = document.getElementById('pipelineBadge');
        this.metricsBadge = document.getElementById('metricsBadge');
        this.activePanel = 'chat';

        this.isProcessing = false;
        this.currentSessionId = localStorage.getItem('millibro_session_id') || null;
        this.currentRoute = null;
        this.agentOutputs = {};
        this.agentTimers = {};
        this.sseBuffer = '';

        this.initViewportHeight();
        this.initEventListeners();
        this.initMobileLayout();
        this.initSession();
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
            window.visualViewport.addEventListener('scroll', updateHeight);
        }
    }

    initEventListeners() {
        this.isUserInteracting = false;
        let interactionTimer = null;
        const markUserInteracting = () => {
            this.isUserInteracting = true;
            if (interactionTimer) clearTimeout(interactionTimer);
            interactionTimer = setTimeout(() => {
                this.isUserInteracting = false;
            }, 1200);
        };

        if (this.chatHistory) {
            this.chatHistory.addEventListener('touchstart', markUserInteracting, { passive: true });
            this.chatHistory.addEventListener('touchmove', markUserInteracting, { passive: true });
            this.chatHistory.addEventListener('touchend', markUserInteracting, { passive: true });
            this.chatHistory.addEventListener('touchcancel', markUserInteracting, { passive: true });
            this.chatHistory.addEventListener('wheel', markUserInteracting, { passive: true });
            this.chatHistory.addEventListener('scroll', markUserInteracting, { passive: true });
        }

        this.sendBtn.addEventListener('click', () => this.handleSend());
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });

        this.userInput.addEventListener('input', () => {
            this.sendBtn.disabled = this.userInput.value.trim() === '' || this.isProcessing;
            this.userInput.style.height = 'auto';
            const maxHeight = this.isMobile() ? 110 : 160;
            this.userInput.style.height = Math.min(this.userInput.scrollHeight, maxHeight) + 'px';
        });

        this.userInput.addEventListener('focus', () => {
            if (this.isMobile()) {
                setTimeout(() => {
                    this.forceScrollToBottom();
                }, 300);
            }
        });

        // Score modal
        if (this.scoreHistoryBtn) {
            this.scoreHistoryBtn.addEventListener('click', () => this.showScoreHistory());
        }
        if (this.closeModalBtn) {
            this.closeModalBtn.addEventListener('click', () => {
                if (this.scoreModal) this.scoreModal.classList.add('hidden');
            });
        }
        if (this.scoreModal) {
            this.scoreModal.addEventListener('click', (e) => {
                if (e.target === this.scoreModal) this.scoreModal.classList.add('hidden');
            });
        }

        // Saved Chats modal & buttons
        if (this.savedChatsBtn) {
            this.savedChatsBtn.addEventListener('click', () => this.showSavedChats());
        }
        if (this.closeSavedChatsModalBtn) {
            this.closeSavedChatsModalBtn.addEventListener('click', () => {
                if (this.savedChatsModal) this.savedChatsModal.classList.add('hidden');
            });
        }
        if (this.savedChatsModal) {
            this.savedChatsModal.addEventListener('click', (e) => {
                if (e.target === this.savedChatsModal) this.savedChatsModal.classList.add('hidden');
            });
        }

        // New Campaign buttons
        if (this.newChatBtn) {
            this.newChatBtn.addEventListener('click', () => this.startNewConversation());
        }
        if (this.studioNewChatBtn) {
            this.studioNewChatBtn.addEventListener('click', () => this.startNewConversation());
        }
        if (this.modalNewChatBtn) {
            this.modalNewChatBtn.addEventListener('click', () => this.startNewConversation());
        }

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

        // 3D Tilt Dynamics
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

    // --- Conversation & Memory Management ---

    async initSession() {
        await this.updateSavedChatsCount();

        // If we have a saved session ID from a previous visit, load it!
        if (this.currentSessionId) {
            const loaded = await this.loadConversation(this.currentSessionId, false);
            if (loaded) return;
        }

        // Otherwise check if there are any conversations on the server
        try {
            const res = await fetch('/api/conversations');
            if (res.ok) {
                const list = await res.json();
                if (list && list.length > 0) {
                    // Load the most recently updated conversation
                    await this.loadConversation(list[0].id, false);
                    return;
                }
            }
        } catch (e) {
            console.log('Error checking conversations on startup:', e);
        }

        // If no conversations exist, show welcome banner and start ready
        this.renderWelcomeCard();
    }

    async updateSavedChatsCount() {
        try {
            const res = await fetch('/api/conversations');
            if (res.ok) {
                const list = await res.json();
                if (this.savedChatsCount) {
                    this.savedChatsCount.textContent = list.length;
                }
                return list.length;
            }
        } catch {
            // Ignore offline/startup
        }
        return 0;
    }

    async loadConversation(sessionId, switchToChat = true) {
        try {
            const res = await fetch(`/api/conversations/${sessionId}`);
            if (!res.ok) return false;
            const conv = await res.json();

            this.currentSessionId = conv.id;
            localStorage.setItem('millibro_session_id', conv.id);

            if (this.chatTitle) {
                this.chatTitle.textContent = conv.title || 'Marketing Campaign';
            }
            if (this.activeChatIndicator) {
                this.activeChatIndicator.textContent = `Campaign: ${conv.title || 'Active'}`;
            }

            // Clear chat history
            this.chatHistory.innerHTML = '';

            const messages = conv.messages || [];
            if (messages.length === 0) {
                this.renderWelcomeCard();
            } else {
                for (const msg of messages) {
                    if (msg.role === 'user') {
                        this.addUserMessage(msg.content, msg.timestamp);
                    } else {
                        let html = '';
                        const route = msg.route || 'direct_answer';
                        if (route === 'full_pipeline' && msg.agent_outputs && Object.keys(msg.agent_outputs).length > 0) {
                            html = '<div class="final-output">';
                            html += '<h2 style="margin-bottom: 16px; color: var(--text-primary);">📋 Marketing Campaign Output</h2>';
                            if (msg.agent_outputs.researcher) {
                                html += `<details style="margin-bottom: 16px;"><summary style="cursor:pointer; font-weight:600; color: var(--researcher-color);">🔍 Research Report</summary><div style="margin-top:8px;">${marked.parse(msg.agent_outputs.researcher)}</div></details>`;
                            }
                            if (msg.agent_outputs.copywriter) {
                                html += `<div style="margin-bottom: 16px; padding: 16px; background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.15); border-radius: 12px;"><h3 style="color: var(--copywriter-color); margin-bottom: 8px;">✍️ Content</h3>${marked.parse(msg.agent_outputs.copywriter)}</div>`;
                            }
                            if (msg.agent_outputs.planner) {
                                html += `<div style="margin-bottom: 16px; padding: 16px; background: rgba(245,158,11,0.05); border: 1px solid rgba(245,158,11,0.15); border-radius: 12px;"><h3 style="color: var(--planner-color); margin-bottom: 8px;">📋 Posting Plan</h3>${marked.parse(msg.agent_outputs.planner)}</div>`;
                            }
                            html += '</div>';
                        } else if (route === 'copywriter' && msg.agent_outputs?.copywriter) {
                            html = `<div style="padding: 16px; background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.15); border-radius: 12px;"><h3 style="color: var(--copywriter-color); margin-bottom: 8px;">✍️ Revised Copy</h3>${marked.parse(msg.agent_outputs.copywriter)}</div>`;
                        } else {
                            html = marked.parse(msg.content || '');
                        }
                        this.addAgentMessage(html, route, msg.timestamp);
                    }
                }
            }

            // Restore score if available
            if (conv.campaign_context?.latest_score) {
                const scoredMsg = [...messages].reverse().find(m => m.score_data && m.score_data.score);
                if (scoredMsg && scoredMsg.score_data) {
                    const s = scoredMsg.score_data;
                    this.showScore(s.score, s.reasoning, 0, s.breakdown, 0);
                }
            }

            if (this.savedChatsModal) {
                this.savedChatsModal.classList.add('hidden');
            }

            if (switchToChat && this.isMobile()) {
                this.switchPanel('chat');
            }

            this.forceScrollToBottom();
            return true;
        } catch (e) {
            console.error('Failed to load conversation:', e);
            return false;
        }
    }

    async startNewConversation() {
        try {
            const res = await fetch('/api/conversations/new', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'New Marketing Campaign' })
            });
            if (res.ok) {
                const conv = await res.json();
                this.currentSessionId = conv.id;
                localStorage.setItem('millibro_session_id', conv.id);
            } else {
                this.currentSessionId = 'conv_' + Date.now();
                localStorage.setItem('millibro_session_id', this.currentSessionId);
            }
        } catch {
            this.currentSessionId = 'conv_' + Date.now();
            localStorage.setItem('millibro_session_id', this.currentSessionId);
        }

        if (this.chatTitle) {
            this.chatTitle.textContent = 'Hello There, Marketer 👋';
        }
        if (this.activeChatIndicator) {
            this.activeChatIndicator.textContent = 'Live Autonomous Studio';
        }

        this.chatHistory.innerHTML = '';
        this.renderWelcomeCard();
        this.resetPipeline();

        const chips = document.querySelector('.starter-chips-carousel');
        if (chips) chips.style.display = 'flex';

        if (this.savedChatsModal) {
            this.savedChatsModal.classList.add('hidden');
        }

        await this.updateSavedChatsCount();

        if (this.isMobile()) {
            this.switchPanel('chat');
        }
    }

    async deleteConversation(sessionId, e) {
        if (e) e.stopPropagation();
        if (!confirm('Are you sure you want to delete this marketing conversation?')) return;
        try {
            await fetch(`/api/conversations/${sessionId}`, { method: 'DELETE' });
            if (this.currentSessionId === sessionId) {
                localStorage.removeItem('millibro_session_id');
                await this.startNewConversation();
            } else {
                await this.showSavedChats();
                await this.updateSavedChatsCount();
            }
        } catch (err) {
            console.error('Failed to delete conversation:', err);
        }
    }

    async showSavedChats() {
        if (!this.savedChatsModal) return;
        this.savedChatsModal.classList.remove('hidden');
        const container = document.getElementById('savedChatsList');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center; padding:24px; color:var(--muted);">Loading conversations...</div>';

        try {
            const res = await fetch('/api/conversations');
            if (!res.ok) throw new Error('Failed to fetch conversations');
            const list = await res.json();

            if (list.length === 0) {
                container.innerHTML = `
                    <div class="empty-chats-banner">
                        <div style="font-size:2rem; margin-bottom:8px;">💬</div>
                        <h3 style="color:var(--ink); font-size:1.05rem;">No saved conversations yet</h3>
                        <p>Ask a question or launch a marketing campaign to start saving your chat history.</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = list.map(c => {
                const isActive = c.id === this.currentSessionId;
                const dateStr = c.updated_at
                    ? new Date(c.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'Recent';
                const scoreHtml = c.latest_score
                    ? `<span class="meta-chip score-chip">Score: ${c.latest_score}/100</span>`
                    : '';
                return `
                    <div class="saved-chat-card ${isActive ? 'active' : ''}" data-id="${c.id}">
                        <div class="chat-card-info">
                            <div class="chat-card-title">${this.escapeHtml(c.title || 'Untitled Campaign')}</div>
                            <div class="chat-card-meta">
                                <span>${dateStr}</span>
                                <span class="meta-chip">${c.message_count} message${c.message_count === 1 ? '' : 's'}</span>
                                ${scoreHtml}
                                ${isActive ? '<span class="meta-chip" style="background:#7c3aed; color:#fff;">Active</span>' : ''}
                            </div>
                        </div>
                        <button class="chat-delete-btn" data-delete-id="${c.id}" title="Delete Conversation" aria-label="Delete">🗑️</button>
                    </div>
                `;
            }).join('');

            container.querySelectorAll('.saved-chat-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.chat-delete-btn')) return;
                    const id = card.getAttribute('data-id');
                    if (id) this.loadConversation(id);
                });
            });

            container.querySelectorAll('.chat-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = btn.getAttribute('data-delete-id');
                    if (id) this.deleteConversation(id, e);
                });
            });

        } catch (err) {
            container.innerHTML = `<div style="text-align:center; padding:24px; color:#ef4444;">Error loading conversations: ${err.message}</div>`;
        }
    }

    renderWelcomeCard() {
        const chips = document.querySelector('.starter-chips-carousel');
        if (chips) chips.style.display = 'flex';

        const welcomeHtml = `
            <div class="chat-message agent welcome">
                <div class="welcome-holo-banner">
                    <div class="banner-tags-row">
                        <span class="banner-chip">AUTONOMOUS WORKFLOW</span>
                        <span style="font-size:0.78rem; color:#10b981; font-weight:600;">● Engine Ready</span>
                    </div>
                    <p class="banner-desc">
                        Welcome to Millibro Marketing Studio. Describe your product, launch goal, or ask any marketing question. Your autonomous fleet will orchestrate competitive research, craft persuasive multi-channel copy, and verify quality. When asking follow-ups, the Marketing Director will answer you directly without unnecessary agent calls.
                    </p>
                    <div class="checklist-preview-grid">
                        <div class="check-card"><span>🔍</span> Deep Audience & Trend Discovery</div>
                        <div class="check-card"><span>✍️</span> High-Converting Hook & Story Thread</div>
                        <div class="check-card"><span>📋</span> Optimal Multi-Channel Schedule</div>
                        <div class="check-card"><span>🎯</span> 4-Metric Conversion Quality Score</div>
                    </div>
                </div>
            </div>
        `;
        this.chatHistory.innerHTML = welcomeHtml;
    }

    // --- Message Sending & Event Pipeline ---

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
        this.currentRoute = null;

        this.resetPipeline();

        if (this.pipelineBadge) {
            this.pipelineBadge.className = 'tab-badge active';
        }

        if (this.isMobile()) {
            const chips = document.querySelector('.starter-chips-carousel');
            if (chips) chips.style.display = 'none';
        }

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    session_id: this.currentSessionId
                })
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
                const events = this.sseBuffer.split('\n\n');
                this.sseBuffer = events.pop();

                for (const block of events) {
                    if (!block.trim()) continue;
                    this.parseSSEBlock(block);
                }
            }
        } catch (error) {
            console.error('Pipeline error:', error);
            this.addAgentMessage(
                `<div class="error-message">⚠️ Connection error: ${this.escapeHtml(error.message)}<br>Make sure the server is running on <code>http://localhost:8000</code></div>`,
                'error'
            );
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
            case 'session_info':
                this.handleSessionInfo(data);
                break;
            case 'routing_decision':
                this.handleRoutingDecision(data);
                break;
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
                break;
            default:
                console.log('Unknown event:', event, data);
        }
    }

    handleSessionInfo(data) {
        if (data.session_id) {
            this.currentSessionId = data.session_id;
            localStorage.setItem('millibro_session_id', data.session_id);
        }
        if (data.title) {
            if (this.chatTitle) {
                this.chatTitle.textContent = data.title;
            }
            if (this.activeChatIndicator) {
                this.activeChatIndicator.textContent = `Campaign: ${data.title}`;
            }
        }
        this.updateSavedChatsCount();
    }

    handleRoutingDecision(data) {
        this.currentRoute = data.route;
        const reasoning = data.reasoning || '';

        // If the route is a single agent or direct answer, update steps appropriately
        if (data.route === 'direct_answer') {
            this.updatePipelineStep('researcher', 'skipped', 'Skipped • Manager answering directly');
            this.updatePipelineStep('copywriter', 'skipped', 'Skipped • Manager answering directly');
            this.updatePipelineStep('planner', 'skipped', 'Skipped • Manager answering directly');
            this.updatePipelineStep('manager-review', 'skipped', 'Skipped • Direct consultation');
            this.updatePipelineStep('manager-plan', 'active', `Marketing Director answering directly: ${reasoning}`);
        } else if (data.route === 'copywriter') {
            this.updatePipelineStep('researcher', 'skipped', 'Skipped • Copy request only');
            this.updatePipelineStep('planner', 'skipped', 'Skipped • Copy request only');
            this.updatePipelineStep('manager-plan', 'completed', `Delegated to Copywriter: ${reasoning}`);
        } else if (data.route === 'researcher') {
            this.updatePipelineStep('copywriter', 'skipped', 'Skipped • Research request only');
            this.updatePipelineStep('planner', 'skipped', 'Skipped • Research request only');
            this.updatePipelineStep('manager-plan', 'completed', `Delegated to Researcher: ${reasoning}`);
        } else if (data.route === 'planner') {
            this.updatePipelineStep('researcher', 'skipped', 'Skipped • Schedule request only');
            this.updatePipelineStep('copywriter', 'skipped', 'Skipped • Schedule request only');
            this.updatePipelineStep('manager-plan', 'completed', `Delegated to Planner: ${reasoning}`);
        }
    }

    mapAgentToStep(agentName) {
        const mapping = {
            'researcher': 'researcher',
            'copywriter': 'copywriter',
            'planner': 'planner',
            'manager': null,
            'system': null
        };
        return mapping[agentName] || agentName;
    }

    getManagerStep(message) {
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

    handleWorkflowStep(data) {
        const agent = data.agent;
        const status = data.status || 'active';
        const message = data.message || '';
        const stepId = this.resolveStepId(agent, message);

        if (!stepId) return;

        this.updatePipelineStep(stepId, status, message);

        if (status === 'active' && !this.agentTimers[stepId]) {
            this.agentTimers[stepId] = Date.now();
        }
    }

    handleAgentChunk(data) {
        const agent = data.agent;
        const delta = data.delta || '';

        let stepId;
        if (agent === 'manager') {
            const reviewStep = document.querySelector('.pipeline-step[data-agent="manager-review"]');
            if (reviewStep && (reviewStep.classList.contains('active') || reviewStep.classList.contains('completed')) && this.currentRoute === 'full_pipeline') {
                stepId = 'manager-review';
            } else {
                stepId = 'manager-plan';
            }
        } else {
            stepId = this.mapAgentToStep(agent);
        }

        if (!stepId) return;

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
            if (reviewStep && (reviewStep.classList.contains('active') || reviewStep.classList.contains('completed')) && this.currentRoute === 'full_pipeline') {
                stepId = 'manager-review';
            } else {
                stepId = 'manager-plan';
            }
        } else {
            stepId = this.mapAgentToStep(agent);
        }

        if (!stepId) return;

        this.agentOutputs[stepId] = content;

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

        this.addAgentMessage(`
            <div style="color: var(--score-fair); border-left: 3px solid var(--score-fair); padding-left: 12px;">
                <strong>🔄 Rework requested for ${agent}</strong> (Attempt ${attempt}/2)<br>
                <em>${this.escapeHtml(feedback)}</em>
            </div>
        `, 'rework');
    }

    handleScore(data) {
        const score = data.score || 0;
        const reasoning = data.reasoning || '';
        const previousBest = data.previous_best || 0;
        const breakdown = data.breakdown || {};
        const reworkCount = data.rework_count || 0;

        this.showScore(score, reasoning, previousBest, breakdown, reworkCount);

        if (this.metricsBadge && this.activePanel !== 'metrics') {
            this.metricsBadge.className = 'tab-badge done active';
        }
    }

    handleDone(data) {
        const route = data.route || this.currentRoute || 'direct_answer';
        let finalHtml = '';

        if (route === 'direct_answer') {
            // Direct manager answer
            const content = this.agentOutputs['manager-plan'] || data.message || '';
            finalHtml = marked.parse(content);
        } else if (route === 'copywriter') {
            const copyContent = this.agentOutputs['copywriter'] || data.content || '';
            finalHtml = `<div style="padding: 16px; background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.15); border-radius: 12px;"><h3 style="color: var(--copywriter-color); margin-bottom: 8px;">✍️ Revised Copy</h3>${marked.parse(copyContent)}</div>`;
        } else if (route === 'researcher') {
            const resContent = this.agentOutputs['researcher'] || data.content || '';
            finalHtml = `<div style="padding: 16px; background: rgba(6,182,212,0.05); border: 1px solid rgba(6,182,212,0.15); border-radius: 12px;"><h3 style="color: var(--researcher-color); margin-bottom: 8px;">🔍 Market Research</h3>${marked.parse(resContent)}</div>`;
        } else if (route === 'planner') {
            const planContent = this.agentOutputs['planner'] || data.content || '';
            finalHtml = `<div style="padding: 16px; background: rgba(245,158,11,0.05); border: 1px solid rgba(245,158,11,0.15); border-radius: 12px;"><h3 style="color: var(--planner-color); margin-bottom: 8px;">📋 Strategy Plan</h3>${marked.parse(planContent)}</div>`;
        } else {
            // Full 5-agent pipeline output
            finalHtml = '<div class="final-output">';
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
        }

        if (this.isMobile()) {
            this.switchPanel('chat');
        }

        const msgEl = this.addAgentMessage(finalHtml, route);

        this.isProcessing = false;
        this.sendBtn.disabled = this.userInput.value.trim() === '';

        if (this.pipelineBadge) {
            this.pipelineBadge.className = 'tab-badge done';
        }

        this.updateSavedChatsCount();

        if (this.isMobile()) {
            setTimeout(() => {
                if (msgEl && !this.isUserInteracting && this.chatHistory) {
                    this.chatHistory.scrollTop = msgEl.offsetTop - 10;
                }
            }, 80);
        } else {
            this.forceScrollToBottom();
        }
    }

    // --- UI Update Helpers ---

    addUserMessage(text, timestamp = null) {
        const welcome = this.chatHistory.querySelector('.chat-message.welcome');
        if (welcome) welcome.remove();

        const msg = document.createElement('div');
        msg.className = 'chat-message user';
        const timeStr = timestamp
            ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msg.innerHTML = `
            <div class="message-content">
                <p>${this.escapeHtml(text)}</p>
                <span class="message-time-stamp" style="color: rgba(255,255,255,0.7);">${timeStr}</span>
            </div>
        `;
        this.chatHistory.appendChild(msg);
        this.forceScrollToBottom();
        return msg;
    }

    addAgentMessage(html, route = 'direct', timestamp = null) {
        const welcome = this.chatHistory.querySelector('.chat-message.welcome');
        if (welcome) welcome.remove();

        const msg = document.createElement('div');
        msg.className = 'chat-message agent';
        const timeStr = timestamp
            ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let badgeHtml = '';
        if (route === 'direct_answer' || route === 'direct') {
            badgeHtml = '<div class="message-routing-badge direct">🧑‍💼 Marketing Director • Direct Consultation</div>';
        } else if (route === 'copywriter') {
            badgeHtml = '<div class="message-routing-badge copywriter">✍️ Copywriter • Targeted Copy Revision</div>';
        } else if (route === 'researcher') {
            badgeHtml = '<div class="message-routing-badge researcher">🔍 Researcher • Targeted Intelligence</div>';
        } else if (route === 'planner') {
            badgeHtml = '<div class="message-routing-badge planner">📋 Planner • Targeted Schedule Strategy</div>';
        } else if (route === 'full_pipeline' || route === 'fleet') {
            badgeHtml = '<div class="message-routing-badge fleet">🚀 Autonomous 5-Agent Fleet • Full Campaign</div>';
        }

        msg.innerHTML = `
            <div class="message-content markdown-output">
                ${badgeHtml}
                ${html}
                <span class="message-time-stamp">${timeStr}</span>
            </div>
        `;
        this.chatHistory.appendChild(msg);
        if (!this.isMobile()) {
            this.forceScrollToBottom();
        }
        return msg;
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
            'skipped': '— Skipped',
            'error': '✗ Error'
        };
        statusSpan.textContent = statusLabels[status] || status;

        if (status === 'skipped') {
            const content = step.querySelector('.step-content');
            content.style.maxHeight = '0px';
            content.style.padding = '0 20px';
            const streamContainer = step.querySelector('.streaming-text');
            streamContainer.textContent = message || 'Skipped (Not needed)';
        } else if (status === 'active' || status === 'reworking') {
            const content = step.querySelector('.step-content');
            content.style.maxHeight = '500px';
            content.style.padding = '0 20px 20px 20px';

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
        } catch {
            mdContainer.textContent = output || '';
        }
        mdContainer.style.display = 'block';

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

            const maxOffset = 283;
            const offset = maxOffset - (targetScore / 100) * maxOffset;
            gaugeProgress.style.strokeDashoffset = offset;

            let color = 'var(--score-excellent)';
            if (targetScore < 80) color = 'var(--score-good)';
            if (targetScore < 60) color = 'var(--score-fair)';
            if (targetScore < 40) color = 'var(--score-poor)';
            gaugeProgress.style.stroke = color;
            scoreValue.style.color = color;

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
        if (this.metricsBadge) {
            this.metricsBadge.className = 'tab-badge';
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

    closeModals() {
        if (this.scoreModal) this.scoreModal.classList.add('hidden');
        if (this.savedChatsModal) this.savedChatsModal.classList.add('hidden');
    }

    // --- Mobile Layout ---

    isMobile() {
        return window.innerWidth <= 980;
    }

    initMobileLayout() {
        if (this.mobileTabs) {
            const tabs = this.mobileTabs.querySelectorAll('.mobile-tab');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const panel = tab.dataset.panel;
                    this.switchPanel(panel);
                });
            });
        }
        this.applyMobileState();
        window.addEventListener('resize', () => {
            this.applyMobileState();
        });
    }

    applyMobileState() {
        if (this.isMobile()) {
            this.switchPanel(this.activePanel);
        } else {
            if (this.chatPanel) this.chatPanel.classList.remove('mobile-hidden');
            if (this.pipelinePanel) this.pipelinePanel.classList.remove('mobile-hidden');
            if (this.hudPanel) this.hudPanel.classList.remove('mobile-hidden');
        }
    }

    switchPanel(panelName) {
        this.activePanel = panelName;
        if (this.mobileTabs) {
            const tabs = this.mobileTabs.querySelectorAll('.mobile-tab');
            tabs.forEach(tab => {
                tab.classList.toggle('active', tab.dataset.panel === panelName);
            });
        }
        if (this.isMobile()) {
            if (panelName === 'chat') {
                if (this.chatPanel) this.chatPanel.classList.remove('mobile-hidden');
                if (this.pipelinePanel) this.pipelinePanel.classList.add('mobile-hidden');
                if (this.hudPanel) this.hudPanel.classList.add('mobile-hidden');
                setTimeout(() => {
                    if (!this.isUserInteracting) {
                        this.scrollToBottom();
                    }
                }, 60);
            } else if (panelName === 'pipeline') {
                if (this.chatPanel) this.chatPanel.classList.add('mobile-hidden');
                if (this.pipelinePanel) this.pipelinePanel.classList.remove('mobile-hidden');
                if (this.hudPanel) this.hudPanel.classList.add('mobile-hidden');
            } else if (panelName === 'metrics') {
                if (this.chatPanel) this.chatPanel.classList.add('mobile-hidden');
                if (this.pipelinePanel) this.pipelinePanel.classList.add('mobile-hidden');
                if (this.hudPanel) this.hudPanel.classList.remove('mobile-hidden');
                if (this.metricsBadge) {
                    this.metricsBadge.className = 'tab-badge';
                }
            }
        }
    }

    forceScrollToBottom() {
        if (!this.chatHistory || this.isUserInteracting) return;
        requestAnimationFrame(() => {
            if (this.chatHistory && !this.isUserInteracting) {
                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
            }
        });
        setTimeout(() => {
            if (this.chatHistory && !this.isUserInteracting) {
                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
            }
        }, 120);
    }

    scrollToBottom(force = false) {
        if (!this.chatHistory) return;
        if (force) {
            this.forceScrollToBottom();
            return;
        }
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
        this.scoreModal.classList.remove('hidden');
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
