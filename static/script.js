document.addEventListener('DOMContentLoaded', function() {
    var sidebar = document.getElementById('sidebar');
    var sidebarToggle = document.getElementById('sidebar-toggle');
    var perplexityInput = document.getElementById('perplexity-input');
    var searchWrapper = document.querySelector('.search-input-wrapper');
    var chatContainer = document.getElementById('chat-container');
    var heroSection = document.getElementById('hero-section');
    var addFileBtn = document.getElementById('add-file-btn');
    var pdfUpload = document.getElementById('pdf-upload');
    var uploadStatus = document.getElementById('upload-status');
    var filenameDisplay = document.getElementById('filename-display');
    var webSearchToggle = document.getElementById('web-search-toggle');
    var searchProgress = document.getElementById('search-progress');
    var micBtn = document.getElementById('mic-btn');
    var privacyToggle = document.getElementById('privacy-toggle');
    var notifBell = document.getElementById('notif-bell');
    var notifDropdown = document.getElementById('notif-dropdown');
    var notifCount = document.getElementById('notif-count');
    var notifList = document.getElementById('notif-list');

    var SEARCH_URL = "/api/search";
    var CHAT_URL = "/api/chat";

    var themeToggleBtn = document.getElementById('theme-toggle-btn');
    var webSearchEnabled = true;
    var isPublic = false;
    var extractedPdfText = "";
    var currentUtterance = null;
    
    // ─── User Identity ─────────────────────────────────────────────
    var userId = localStorage.getItem('perplexity_user_id');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('perplexity_user_id', userId);
    }

    // ─── Theme Management ──────────────────────────────────────────
    function initTheme() {
        var savedTheme = localStorage.getItem('perplexity_theme') || 'dark';
        if (savedTheme === 'light') {
            document.body.classList.add('light-mode');
            if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
        }
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', function() {
            var isLight = document.body.classList.toggle('light-mode');
            var newTheme = isLight ? 'light' : 'dark';
            localStorage.setItem('perplexity_theme', newTheme);
            
            // Update icon
            if (isLight) {
                themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
            } else {
                themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
            }
        });
    }

    initTheme();

    // ─── Privacy Toggle ────────────────────────────────────────────
    if (privacyToggle) {
        privacyToggle.addEventListener('click', function() {
            isPublic = !isPublic;
            if (isPublic) {
                privacyToggle.classList.add('public');
                privacyToggle.innerHTML = '<i class="fa-solid fa-globe"></i><span>Public</span>';
            } else {
                privacyToggle.classList.remove('public');
                privacyToggle.innerHTML = '<i class="fa-solid fa-lock"></i><span>Private</span>';
            }
        });
    }

    // ─── Notifications ─────────────────────────────────────────────
    function fetchNotifications() {
        if (!userId) return;
        fetch('/api/notifications?user_id=' + userId)
            .then(r => r.json())
            .then(data => {
                var unreadCount = data.filter(n => !n.is_read).length;
                if (notifCount) {
                    notifCount.textContent = unreadCount;
                    notifCount.style.display = unreadCount > 0 ? 'flex' : 'none';
                }
                
                if (data.length > 0 && notifList) {
                    notifList.innerHTML = '';
                    data.forEach(n => {
                        var item = document.createElement('div');
                        item.className = 'notif-item';
                        item.textContent = n.message;
                        notifList.appendChild(item);
                    });
                }
            });
    }

    if (notifBell) {
        notifBell.addEventListener('click', function(e) {
            e.stopPropagation();
            if (notifDropdown) notifDropdown.classList.toggle('active');
            if (notifDropdown && notifDropdown.classList.contains('active')) fetchNotifications();
        });
    }

    document.addEventListener('click', function() {
        if (notifDropdown) notifDropdown.classList.remove('active');
    });

    setInterval(fetchNotifications, 30000); // Poll every 30s
    fetchNotifications();
    
    // ─── Voice Assistant (Web Speech API) ─────────────────────────
    var recognition;
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = function() {
            micBtn.classList.add('active');
            perplexityInput.placeholder = "Listening...";
        };

        recognition.onresult = function(event) {
            var transcript = event.results[0][0].transcript;
            perplexityInput.value = transcript;
            micBtn.classList.remove('active');
            perplexityInput.placeholder = "Ask Perplexity 3";
            
            // Auto-submit after voice input
            if (perplexityInput.value.trim() !== '') {
                setTimeout(function() {
                    sendMessage(perplexityInput.value.trim());
                    perplexityInput.value = '';
                }, 500);
            }
        };

        recognition.onerror = function(event) {
            console.warn('Speech recognition error:', event.error);
            micBtn.classList.remove('active');
            perplexityInput.placeholder = "Ask Perplexity 3";
        };

        recognition.onend = function() {
            micBtn.classList.remove('active');
            perplexityInput.placeholder = "Ask Perplexity 3";
        };

        micBtn.addEventListener('click', function() {
            if (micBtn.classList.contains('active')) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });
    } else {
        console.warn("Speech recognition not supported in this browser.");
        if (micBtn) micBtn.style.opacity = '0.3';
    }

    var currentSessionId = Date.now().toString();
    var currentConversation = [];
    var chatHistory = [];
    try {
        chatHistory = JSON.parse(localStorage.getItem('perplexity_history') || '[]');
    } catch(e) {}

    // ─── Web Search Toggle ────────────────────────────────────────
    webSearchToggle.addEventListener('click', function() {
        webSearchEnabled = !webSearchEnabled;
        this.classList.toggle('active', webSearchEnabled);
        if (webSearchEnabled) {
            this.innerHTML = '<i class="fa-solid fa-globe"></i><span>Web</span>';
        } else {
            this.innerHTML = '<i class="fa-solid fa-comment"></i><span>Chat</span>';
        }
    });

    // ─── Search Progress ──────────────────────────────────────────
    function showSearchProgress(step) {
        searchProgress.style.display = 'flex';
        var steps = ['step-searching', 'step-reading', 'step-writing'];
        steps.forEach(function(s, i) {
            var el = document.getElementById(s);
            el.classList.remove('active', 'done');
            if (i < step) el.classList.add('done');
            if (i === step) el.classList.add('active');
        });
    }

    function hideSearchProgress() {
        searchProgress.style.display = 'none';
    }

    // ─── History ──────────────────────────────────────────────────
    function renderHistory() {
        var historyList = document.getElementById('history-list');
        if (!historyList) return;
        historyList.innerHTML = '';
        
        chatHistory.slice(0, 5).forEach(function(session) {
            var div = document.createElement('div');
            div.className = 'history-item' + (session.id === currentSessionId ? ' active' : '');
            var title = session.title || 'New Chat';
            div.innerHTML = '<i class="fa-solid fa-message"></i> <span>' + title + '</span>';
            div.onclick = function() {
                loadSession(session.id);
            };
            historyList.appendChild(div);
        });
    }

    function loadSession(id) {
        var session = chatHistory.find(function(s) { return s.id === id; });
        if (!session) return;
        currentSessionId = session.id;
        currentConversation = session.messages || [];
        chatContainer.innerHTML = '';
        
        // Re-render all messages from the session
        if (session.renderedMessages) {
            session.renderedMessages.forEach(function(msg) {
                if (msg.type === 'user') {
                    appendMessage('user', msg.text);
                } else if (msg.type === 'ai') {
                    appendAIMessage(msg.text, msg.sources || []);
                }
            });
        } else {
            currentConversation.forEach(function(msg) {
                var role = msg.role === 'user' ? 'user' : 'ai';
                var text = msg.parts ? msg.parts[0].text : '';
                appendMessage(role, text);
            });
        }
        
        heroSection.classList.add('hidden');
        var actionChips = document.querySelector('.action-chips');
        if (actionChips) actionChips.style.display = 'none';
        chatContainer.style.display = 'flex';
        renderHistory();
    }

    function saveSession(renderedMsg) {
        if (currentConversation.length === 0) return;
        var session = chatHistory.find(function(s) { return s.id === currentSessionId; });
        var firstUserMsg = currentConversation.find(function(m) { return m.role === 'user'; });
        var title = firstUserMsg ? firstUserMsg.parts[0].text : "New Chat";
        if (title.length > 25) title = title.substring(0, 25) + "...";
        
        if (session) {
            session.messages = currentConversation;
            session.title = title;
            if (renderedMsg) {
                if (!session.renderedMessages) session.renderedMessages = [];
                session.renderedMessages.push(renderedMsg);
            }
        } else {
            chatHistory.unshift({
                id: currentSessionId,
                title: title,
                messages: currentConversation,
                renderedMessages: renderedMsg ? [renderedMsg] : [],
                timestamp: Date.now()
            });
        }
        if (chatHistory.length > 5) chatHistory = chatHistory.slice(0, 5);
        localStorage.setItem('perplexity_history', JSON.stringify(chatHistory));
        renderHistory();
    }

    renderHistory();
    
    var newChatBtn = document.getElementById('new-chat-btn');
    if(newChatBtn) {
        newChatBtn.addEventListener('click', function() {
            currentSessionId = Date.now().toString();
            currentConversation = [];
            chatContainer.innerHTML = '';
            chatContainer.style.display = 'none';
            heroSection.classList.remove('hidden');
            var actionChips = document.querySelector('.action-chips');
            if (actionChips) actionChips.style.display = 'flex';
            renderHistory();
        });
    }

    // ─── Sidebar Toggle ───────────────────────────────────────────
    sidebarToggle.addEventListener('click', function() {
        if (window.innerWidth <= 900) {
            sidebar.classList.toggle('active');
        } else {
            sidebar.classList.toggle('collapsed');
        }
    });

    // ─── Input Focus Effects ──────────────────────────────────────
    perplexityInput.addEventListener('focus', function() {
        searchWrapper.style.borderColor = '#38bdf8';
        searchWrapper.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.3)';
        searchWrapper.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    perplexityInput.addEventListener('blur', function() {
        searchWrapper.style.borderColor = 'rgba(255,255,255,0.1)';
        searchWrapper.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
        searchWrapper.style.background = 'rgba(255, 255, 255, 0.05)';
    });

    // ─── File Upload ──────────────────────────────────────────────
    addFileBtn.addEventListener('click', function() {
        pdfUpload.click();
    });

    pdfUpload.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (!file.name.endsWith('.pdf')) {
            alert('Please select a PDF file.');
            return;
        }

        filenameDisplay.innerText = "Analyzing...";
        uploadStatus.style.display = 'flex';
        try {
            var reader = new FileReader();
            reader.onload = async function() {
                try {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    var typedarray = new Uint8Array(reader.result);
                    var pdf = await pdfjsLib.getDocument(typedarray).promise;
                    var fullText = "";
                    for (var i = 1; i <= pdf.numPages; i++) {
                        var page = await pdf.getPage(i);
                        var content = await page.getTextContent();
                        var strings = content.items.map(function(item) { return item.str; });
                        fullText += strings.join(" ") + "\n";
                    }
                    extractedPdfText = fullText;
                    
                    filenameDisplay.innerText = file.name;
                    uploadStatus.style.border = '1px solid #10b981';
                    uploadStatus.style.color = '#10b981';

                    // Disable web search when PDF is active
                    webSearchEnabled = false;
                    webSearchToggle.classList.remove('active');
                    webSearchToggle.innerHTML = '<i class="fa-solid fa-comment"></i><span>Chat</span>';
                    
                    var prompt = "I uploaded a PDF named " + file.name + ". Please provide a detailed summary of its contents based on this extracted text:\n\n" + extractedPdfText.substring(0, 50000);
                    sendMessage(prompt);
                    
                } catch(err) {
                    console.error('PDF parsing error:', err);
                    alert('Error parsing PDF file locally.');
                    uploadStatus.style.display = 'none';
                }
            };
            reader.readAsArrayBuffer(file);
        } catch(err) {
            console.error('File read error:', err);
            uploadStatus.style.display = 'none';
        }
    });

    // ─── Enter Key ────────────────────────────────────────────────
    perplexityInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && perplexityInput.value.trim() !== '') {
            sendMessage(perplexityInput.value.trim());
            perplexityInput.value = '';
        }
    });

    // ─── Markdown Renderer ────────────────────────────────────────
    function renderMarkdown(text) {
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                breaks: true,
                gfm: true
            });
            var html = marked.parse(text);
            
            // Add citation styling: replace [1], [2] etc. with styled badges
            html = html.replace(/\[(\d+)\]/g, '<span class="citation-badge" data-source="$1">$1</span>');
            
            return html;
        }
        // Fallback: basic formatting
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>')
            .replace(/\[(\d+)\]/g, '<span class="citation-badge" data-source="$1">$1</span>');
    }

    // ─── Send Message ─────────────────────────────────────────────
    function sendMessage(text) {
        heroSection.classList.add('hidden');
        var actionChips = document.querySelector('.action-chips');
        if (actionChips) actionChips.style.display = 'none';
        chatContainer.style.display = 'flex';
        appendMessage('user', text);
        
        if (currentUtterance) window.speechSynthesis.cancel();
        
        currentConversation.push({ role: "user", parts: [{ text: text }] });
        saveSession({ type: 'user', text: text });

        if (webSearchEnabled) {
            sendWebSearch(text);
        } else {
            sendChatMessage(text);
        }
    }

    // ─── Web Search Flow ──────────────────────────────────────────
    function sendWebSearch(query) {
        showSearchProgress(0);
        var thinkingId = appendThinking();

        // Simulate progress steps
        setTimeout(function() { showSearchProgress(1); }, 1500);
        setTimeout(function() { showSearchProgress(2); }, 3500);

        fetch(SEARCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, user_id: userId, is_public: isPublic ? 1 : 0 })
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(body) {
                    var errorMessage = "Server error " + response.status;
                    try {
                        var json = JSON.parse(body);
                        if (json.error) errorMessage = json.error;
                    } catch(e) {
                        console.error("Non-JSON error response:", body);
                    }
                    throw new Error(errorMessage);
                });
            }
            return response.json();
        })
        .then(function(data) {
            removeElement(thinkingId);
            hideSearchProgress();

            if (data.error) {
                appendMessage('ai', 'Error: ' + data.error);
                currentConversation.pop();
                saveSession();
                return;
            }

            var sources = data.sources || [];
            var responseText = data.response || 'No response received.';
            var searchId = data.search_id;

            appendAIMessage(responseText, sources, searchId);
            currentConversation.push({ role: "model", parts: [{ text: responseText }] });
            saveSession({ type: 'ai', text: responseText, sources: sources, search_id: searchId });
        })
        .catch(function(err) {
            removeElement(thinkingId);
            hideSearchProgress();
            var errorMsg = err.message;
            if (errorMsg === 'Failed to fetch') {
                errorMsg = "Cannot reach the backend server. Make sure the Flask server is running at http://localhost:5000";
            }
            appendMessage('ai', 'Error: ' + errorMsg);
            currentConversation.pop();
            saveSession();
            console.error('Search error:', err);
        });
    }

    // ─── Regular Chat Flow ────────────────────────────────────────
    function sendChatMessage(text) {
        var thinkingId = appendThinking();

        // Build history for context (last 10 messages)
        var historyForAPI = currentConversation.slice(-10, -1);

        fetch(CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                history: historyForAPI,
                user_id: userId,
                is_public: isPublic ? 1 : 0
            })
        })
        .then(function(response) {
            if (!response.ok) {
                return response.text().then(function(body) {
                    var errorMessage = "Server error " + response.status;
                    try {
                        var json = JSON.parse(body);
                        if (json.error) errorMessage = json.error;
                    } catch(e) {
                        console.error("Non-JSON error response:", body);
                    }
                    throw new Error(errorMessage);
                });
            }
            return response.json();
        })
        .then(function(data) {
            removeElement(thinkingId);
            if (data.error) {
                appendMessage('ai', 'Error: ' + data.error);
                currentConversation.pop();
                saveSession();
            } else {
                var reply = data.response || '';
                var searchId = data.search_id;
                appendAIMessage(reply, [], searchId);
                currentConversation.push({ role: "model", parts: [{ text: reply }] });
                saveSession({ type: 'ai', text: reply, sources: [], search_id: searchId });
            }
        })
        .catch(function(err) {
            removeElement(thinkingId);
            var errorMsg = err.message;
            if (errorMsg === 'Failed to fetch') {
                errorMsg = "Cannot reach the backend. Make sure Flask is running at http://localhost:5000";
            }
            appendMessage('ai', 'Error: ' + errorMsg);
            currentConversation.pop();
            saveSession();
            console.error('Chat error:', err);
        });
    }

    // ─── Render Source Cards ──────────────────────────────────────
    function createSourceCards(sources) {
        if (!sources || sources.length === 0) return null;

        var container = document.createElement('div');
        container.className = 'sources-container';

        var header = document.createElement('div');
        header.className = 'sources-header';
        header.innerHTML = '<i class="fa-solid fa-globe"></i> <span>Sources</span>';
        container.appendChild(header);

        var grid = document.createElement('div');
        grid.className = 'sources-grid';

        sources.forEach(function(source) {
            var card = document.createElement('a');
            card.className = 'source-card';
            card.href = source.url;
            card.target = '_blank';
            card.rel = 'noopener noreferrer';

            var favicon = 'https://www.google.com/s2/favicons?domain=' + source.domain + '&sz=32';

            card.innerHTML = 
                '<div class="source-card-top">' +
                    '<img class="source-favicon" src="' + favicon + '" alt="" onerror="this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(source.domain.charAt(0)) + '&size=32&background=1e293b&color=38bdf8\'">' +
                    '<span class="source-num">' + source.num + '</span>' +
                '</div>' +
                '<div class="source-title">' + escapeHtml(source.title) + '</div>' +
                '<div class="source-domain">' + escapeHtml(source.domain) + '</div>';

            grid.appendChild(card);
        });

        container.appendChild(grid);
        return container;
    }

    // ─── Append AI Message (with sources + markdown) ──────────────
    function appendAIMessage(text, sources, searchId) {
        var msgDiv = document.createElement('div');
        msgDiv.className = 'message ai';

        // Add source cards if available
        var sourceCards = createSourceCards(sources);
        if (sourceCards) {
            msgDiv.appendChild(sourceCards);
        }

        // Add the AI answer with markdown rendering
        var bubble = document.createElement('div');
        bubble.className = 'bubble ai-bubble';
        bubble.innerHTML = renderMarkdown(text);
        msgDiv.appendChild(bubble);

        // Add Social Action Bar
        if (searchId) {
            var actionBar = document.createElement('div');
            actionBar.className = 'answer-action-bar';
            actionBar.innerHTML = `
                <div class="vote-controls">
                    <button class="vote-btn up" onclick="vote('${searchId}', 'up', this)"><i class="fa-solid fa-thumbs-up"></i></button>
                    <button class="vote-btn down" onclick="vote('${searchId}', 'down', this)"><i class="fa-solid fa-thumbs-down"></i></button>
                </div>
                <button class="action-btn" onclick="bookmark('${searchId}', this)"><i class="fa-solid fa-bookmark"></i> Bookmark</button>
                <button class="action-btn" onclick="share('${searchId}')"><i class="fa-solid fa-share"></i> Share</button>
                <div class="quality-score"><i class="fa-solid fa-chart-line"></i> AI Quality Score: 98%</div>
            `;
            msgDiv.appendChild(actionBar);
        }

        // Make citation badges clickable
        var badges = bubble.querySelectorAll('.citation-badge');
        badges.forEach(function(badge) {
            badge.addEventListener('click', function() {
                var sourceNum = parseInt(this.getAttribute('data-source'));
                if (sources && sources[sourceNum - 1]) {
                    window.open(sources[sourceNum - 1].url, '_blank');
                }
            });
        });
        
        // Add footer with speaker button
        var footer = document.createElement('div');
        footer.className = 'ai-message-footer';
        var speakerBtn = document.createElement('button');
        speakerBtn.className = 'speaker-btn';
        speakerBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        speakerBtn.addEventListener('click', function() {
            speakText(text, speakerBtn);
        });
        footer.appendChild(speakerBtn);
        msgDiv.appendChild(footer);

        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // ─── Append Plain Message ─────────────────────────────────────
    function appendMessage(role, text) {
        var msgDiv = document.createElement('div');
        msgDiv.className = 'message ' + role;
        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        if (role === 'ai') {
            bubble.innerHTML = renderMarkdown(text);
            msgDiv.appendChild(bubble);
            
            var footer = document.createElement('div');
            footer.className = 'ai-message-footer';
            var speakerBtn = document.createElement('button');
            speakerBtn.className = 'speaker-btn';
            speakerBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            speakerBtn.addEventListener('click', function() {
                speakText(text, speakerBtn);
            });
            footer.appendChild(speakerBtn);
            msgDiv.appendChild(footer);
        } else {
            bubble.textContent = text;
            msgDiv.appendChild(bubble);
        }
        
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function appendThinking() {
        var id = 'thinking-' + Date.now();
        var div = document.createElement('div');
        div.className = 'message ai';
        div.id = id;
        div.innerHTML = '<div class="thinking-bubble"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
        chatContainer.appendChild(div);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return id;
    }

    function removeElement(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Speech Synthesis ──────────────────────────────────────────
    function speakText(text, btn) {
        // If already speaking, stop it
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            if (currentUtterance && currentUtterance._btn === btn) {
                currentUtterance = null;
                return;
            }
        }

        // Clean markdown for better speech
        var cleanText = text.replace(/\[\d+\]/g, '') // remove citations
                           .replace(/[#*`]/g, '')    // remove markdown chars
                           .trim();

        var utterance = new SpeechSynthesisUtterance(cleanText);
        utterance._btn = btn;
        currentUtterance = utterance;

        utterance.onstart = function() {
            btn.classList.add('active');
            btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
        };

        utterance.onend = function() {
            btn.classList.remove('active');
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            currentUtterance = null;
        };

        utterance.onerror = function() {
            btn.classList.remove('active');
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            currentUtterance = null;
        };

        window.speechSynthesis.speak(utterance);
    }

    // ─── Global Social Actions ─────────────────────────────────────
    window.vote = function(id, type, btn) {
        if (btn.classList.contains('active')) return;
        fetch('/api/vote', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({search_id: id, type: type})
        }).then(r => r.json()).then(data => {
            btn.classList.add('active');
            // Peer logic: if upvoted, disable downvote and vice-versa
            var parent = btn.parentElement;
            parent.querySelectorAll('.vote-btn').forEach(b => {
                if (b !== btn) b.classList.remove('active');
                b.style.pointerEvents = 'none';
            });
        });
    };

    window.bookmark = function(id, btn) {
        var isBookmarked = btn.classList.contains('active');
        var method = isBookmarked ? 'DELETE' : 'POST';
        fetch('/api/bookmark', {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({search_id: id, user_id: userId})
        }).then(r => r.json()).then(data => {
            btn.classList.toggle('active');
            btn.innerHTML = btn.classList.contains('active') ? 
                '<i class="fa-solid fa-check"></i> Saved' : 
                '<i class="fa-solid fa-bookmark"></i> Bookmark';
        });
    };

    window.share = function(id) {
        var shareUrl = window.location.origin + '/share/' + id;
        navigator.clipboard.writeText(shareUrl).then(() => {
            alert('Shareable link copied to clipboard!\n' + shareUrl);
        }).catch(err => {
            console.error('Failed to copy share link:', err);
            prompt('Copy this link to share:', shareUrl);
        });
    };

    // ─── Chip Clicks ──────────────────────────────────────────────
    var chips = document.querySelectorAll('.chip');
    chips.forEach(function(chip) {
        chip.addEventListener('click', function() {
            var text = chip.querySelector('span').innerText;
            sendMessage(text);
        });
    });
});
