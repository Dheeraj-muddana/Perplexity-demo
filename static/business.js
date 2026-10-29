// ═══════════════════════════════════════════════════════
//  BUSINESS MODE — Frontend Logic
// ═══════════════════════════════════════════════════════

(function() {
    // User identity
    var userId = localStorage.getItem('perplexity_user_id');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('perplexity_user_id', userId);
    }

    // State
    var currentField = 'General';
    var lastQuery = '';
    var lastAnswer = '';
    var lastField = '';

    // Quick search topics per field
    var fieldTopics = {
        'Finance': [
            'Cash Flow Analysis Strategies',
            'Revenue Forecasting Models',
            'Startup Funding Options 2025',
            'Financial Risk Management',
            'Tax Optimization for SMEs',
            'Profit Margin Benchmarks'
        ],
        'Marketing': [
            'Digital Marketing ROI Metrics',
            'Social Media Growth Strategy',
            'SEO Best Practices 2025',
            'Content Marketing Framework',
            'Brand Positioning Techniques',
            'Email Marketing Automation'
        ],
        'Legal': [
            'Business Compliance Checklist',
            'Contract Negotiation Tips',
            'Intellectual Property Protection',
            'Data Privacy Regulations GDPR',
            'Employment Law Essentials',
            'Corporate Governance Standards'
        ],
        'HR & Recruitment': [
            'Remote Hiring Best Practices',
            'Employee Retention Strategies',
            'Compensation Benchmarking',
            'Diversity & Inclusion Programs',
            'Performance Review Frameworks',
            'Onboarding Process Design'
        ],
        'Operations': [
            'Supply Chain Optimization',
            'Lean Manufacturing Principles',
            'Inventory Management Systems',
            'Process Automation with AI',
            'Quality Control Frameworks',
            'Logistics Cost Reduction'
        ],
        'Sales': [
            'B2B Sales Pipeline Building',
            'Closing Techniques That Work',
            'CRM System Comparison 2025',
            'Sales Forecasting Methods',
            'Cold Outreach Templates',
            'Account Based Selling'
        ]
    };

    // ─── Dashboard Navigation ─────────────────────────────────────
    window.showField = function(field) {
        currentField = field;
        document.getElementById('biz-dashboard').style.display = 'none';
        document.getElementById('biz-field-section').style.display = 'block';
        document.getElementById('field-title').textContent = field;
        document.getElementById('biz-field-select').value = field;

        var container = document.getElementById('quick-searches');
        container.innerHTML = '';
        var topics = fieldTopics[field] || [];
        topics.forEach(function(topic) {
            var btn = document.createElement('button');
            btn.className = 'biz-quick-btn';
            btn.textContent = topic;
            btn.onclick = function() {
                document.getElementById('biz-input').value = topic;
                document.getElementById('biz-field-select').value = field;
                doBizSearch();
            };
            container.appendChild(btn);
        });
    };

    window.showDashboard = function() {
        document.getElementById('biz-dashboard').style.display = 'block';
        document.getElementById('biz-field-section').style.display = 'none';
        document.getElementById('biz-answer-area').style.display = 'none';
    };

    // ─── Business Search ──────────────────────────────────────────
    window.doBizSearch = function() {
        var input = document.getElementById('biz-input');
        var query = input.value.trim();
        if (!query) return;

        var field = document.getElementById('biz-field-select').value;
        lastQuery = query;
        lastField = field;

        // Show loading
        document.getElementById('biz-loading').style.display = 'flex';
        document.getElementById('biz-answer-area').style.display = 'none';

        fetch('/api/business/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, field: field, user_id: userId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            document.getElementById('biz-loading').style.display = 'none';

            if (data.error) {
                alert('Error: ' + data.error);
                return;
            }

            lastAnswer = data.response || '';
            renderBusinessAnswer(data);
        })
        .catch(function(err) {
            document.getElementById('biz-loading').style.display = 'none';
            alert('Search failed: ' + err.message);
        });

        input.value = '';
    };

    // Enter key support
    var bizInput = document.getElementById('biz-input');
    if (bizInput) {
        bizInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') doBizSearch();
        });
    }

    // ─── Render Structured Answer ─────────────────────────────────
    function renderBusinessAnswer(data) {
        document.getElementById('biz-answer-area').style.display = 'block';
        document.getElementById('answer-field-badge').textContent = data.field || lastField;
        document.getElementById('answer-query').textContent = lastQuery;

        // Render sources
        var sourcesRow = document.getElementById('biz-sources-row');
        sourcesRow.innerHTML = '';
        if (data.sources && data.sources.length > 0) {
            data.sources.forEach(function(s) {
                var card = document.createElement('a');
                card.className = 'biz-source-chip';
                card.href = s.url;
                card.target = '_blank';
                card.innerHTML = '<i class="fa-solid fa-globe"></i> ' + s.domain;
                sourcesRow.appendChild(card);
            });
        }

        // Parse structured sections from markdown
        var text = data.response || '';
        var answerDiv = document.getElementById('biz-structured-answer');

        // Try to parse structured format
        var sections = parseStructuredAnswer(text);
        var html = '';

        if (sections.summary) {
            html += '<div class="biz-section"><div class="biz-section-title"><i class="fa-solid fa-align-left"></i> Summary</div><div class="biz-section-content">' + renderMd(sections.summary) + '</div></div>';
        }
        if (sections.keyFacts) {
            html += '<div class="biz-section"><div class="biz-section-title"><i class="fa-solid fa-lightbulb"></i> Key Facts</div><div class="biz-section-content">' + renderMd(sections.keyFacts) + '</div></div>';
        }
        if (sections.actionableSteps) {
            html += '<div class="biz-section"><div class="biz-section-title"><i class="fa-solid fa-list-check"></i> Actionable Steps</div><div class="biz-section-content">' + renderMd(sections.actionableSteps) + '</div></div>';
        }

        if (!html) {
            // Fallback: render the entire answer as one block
            html = '<div class="biz-section"><div class="biz-section-content">' + renderMd(text) + '</div></div>';
        }

        answerDiv.innerHTML = html;

        // Related topics as chips
        var chipsDiv = document.getElementById('biz-related-chips');
        chipsDiv.innerHTML = '';
        if (sections.relatedTopics) {
            var topics = sections.relatedTopics.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
            topics.forEach(function(topic) {
                var chip = document.createElement('button');
                chip.className = 'biz-related-chip';
                chip.textContent = topic;
                chip.onclick = function() {
                    document.getElementById('biz-input').value = topic;
                    doBizSearch();
                };
                chipsDiv.appendChild(chip);
            });
        }

        // Scroll to answer
        document.getElementById('biz-answer-area').scrollIntoView({ behavior: 'smooth' });
    }

    function parseStructuredAnswer(text) {
        var result = { summary: '', keyFacts: '', actionableSteps: '', relatedTopics: '' };
        
        // More robust parsing for different heading styles
        var summaryMatch = text.match(/##\s*Summary\s*\n([\s\S]*?)(?=##\s*Key Facts|##\s*Key Insights|##\s*Actionable|##\s*Related|$)/i);
        var factsMatch = text.match(/##\s*(Key Facts|Key Insights)\s*\n([\s\S]*?)(?=##\s*Actionable|##\s*Related|$)/i);
        var stepsMatch = text.match(/##\s*(Actionable Steps|Actionable Items|Next Steps)\s*\n([\s\S]*?)(?=##\s*Related|$)/i);
        var relatedMatch = text.match(/##\s*Related Topics\s*\n([\s\S]*?)$/i);

        if (summaryMatch) result.summary = summaryMatch[1].trim();
        if (factsMatch) result.keyFacts = (factsMatch[2] || factsMatch[1]).trim();
        if (stepsMatch) result.actionableSteps = (stepsMatch[2] || stepsMatch[1]).trim();
        if (relatedMatch) result.relatedTopics = relatedMatch[1].trim();

        return result;
    }

    function renderMd(text) {
        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            return marked.parse(text);
        }
        return text.replace(/\n/g, '<br>');
    }

    // ─── Save Report ──────────────────────────────────────────────
    window.saveReport = function() {
        if (!lastQuery || !lastAnswer) return;
        var btn = document.getElementById('save-report-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        fetch('/api/business/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                query: lastQuery,
                answer: lastAnswer,
                field: lastField
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
            btn.style.background = 'rgba(34, 197, 94, 0.2)';
            btn.style.borderColor = '#22c55e';
            btn.style.color = '#22c55e';
            loadStats();
            setTimeout(function() {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save as Report';
                btn.style.background = '';
                btn.style.borderColor = '';
                btn.style.color = '';
            }, 3000);
        });
    };

    // ─── Export PDF ────────────────────────────────────────────────
    window.exportPDF = function() {
        if (!lastQuery || !lastAnswer) return;
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF();

        // Title
        doc.setFontSize(18);
        doc.setTextColor(30, 58, 95);
        doc.text(lastField + ' Report', 20, 20);

        // Query
        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text('Query: ' + lastQuery, 20, 35);

        // Date
        doc.setFontSize(10);
        doc.text('Generated: ' + new Date().toLocaleString(), 20, 42);

        // Separator
        doc.setDrawColor(56, 189, 248);
        doc.line(20, 46, 190, 46);

        // Answer content (clean markdown)
        doc.setFontSize(11);
        doc.setTextColor(40, 40, 40);
        var cleanText = lastAnswer
            .replace(/##\s*/g, '\n')
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/`/g, '');
        var lines = doc.splitTextToSize(cleanText, 170);
        doc.text(lines, 20, 55);

        // Footer
        var pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('Perplexity 3 — Business Intelligence Report', 20, pageHeight - 10);

        doc.save(lastField.replace(/\s+/g, '_') + '_Report.pdf');
    };

    // ─── Load News ────────────────────────────────────────────────
    function loadNews() {
        fetch('/api/business/news')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var list = document.getElementById('news-list');
            if (!data || data.length === 0) {
                list.innerHTML = '<div class="biz-news-empty">No news available</div>';
                return;
            }
            list.innerHTML = '';
            data.forEach(function(item) {
                var card = document.createElement('div');
                card.className = 'biz-news-card';
                card.innerHTML = '<div class="biz-news-title">' + item.title + '</div>' +
                    '<div class="biz-news-meta"><span>' + (item.source || '') + '</span></div>';
                card.onclick = function() {
                    document.getElementById('biz-input').value = item.title;
                    document.getElementById('biz-field-select').value = 'General';
                    doBizSearch();
                };
                list.appendChild(card);
            });
        })
        .catch(function() {
            document.getElementById('news-list').innerHTML = '<div class="biz-news-empty">Could not load news</div>';
        });
    }

    // ─── Load Stats ───────────────────────────────────────────────
    function loadStats() {
        fetch('/api/business/stats?user_id=' + userId)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            document.getElementById('stat-searches').textContent = data.total_searches || 0;
            document.getElementById('stat-reports').textContent = data.reports_saved || 0;
            if (data.most_used_field) {
                document.getElementById('stat-field').textContent = data.most_used_field.field || '—';
            }
        });
    }

    // Initialize
    loadNews();
    loadStats();
})();
