/**
 * AI分析結果顯示模組
 * 負責解析AI回應並顯示在分頁式界面中
 */

class AIAnalysisDisplay {
    constructor() {
        this.analysisHistory = {
            news: null,
            risk: null
        };
    }

    /**
     * 顯示AI分析結果
     * @param {Object} result - AI分析結果
     * @param {string} analysisType - 分析類型 (news/risk)
     * @param {string} stockName - 股票名稱
     */
    displayAnalysisResult(result, analysisType, stockName) {
        // 解析AI回應
        const parsedContent = this.parseAIResponse(result.content, analysisType);
        
        // 保存分析歷史
        this.saveAnalysisHistory(analysisType, {
            ...result,
            ...parsedContent,
            stockName: stockName,
            timestamp: new Date().toLocaleString('zh-TW')
        });
        
        // 顯示結果區域
        document.getElementById('aiAnalysisResult').style.display = 'block';
        
        // 根據分析類型顯示對應的分頁
        if (analysisType === 'news') {
            this.displayNewsAnalysis(parsedContent, stockName);
            // 激活消息面分頁
            const newsTabBtn = document.querySelector('#aiResultTabs .nav-link[href="#news-analysis-tab"]');
            const riskTabBtn = document.querySelector('#aiResultTabs .nav-link[href="#risk-analysis-tab"]');
            const newsTabPane = document.getElementById('news-analysis-tab');
            const riskTabPane = document.getElementById('risk-analysis-tab');
            
            if (newsTabBtn && riskTabBtn && newsTabPane && riskTabPane) {
                newsTabBtn.classList.add('active');
                riskTabBtn.classList.remove('active');
                newsTabPane.classList.add('show', 'active');
                riskTabPane.classList.remove('show', 'active');
            }
        } else {
            this.displayRiskAnalysis(parsedContent, stockName);
            // 激活風險面分頁
            const newsTabBtn = document.querySelector('#aiResultTabs .nav-link[href="#news-analysis-tab"]');
            const riskTabBtn = document.querySelector('#aiResultTabs .nav-link[href="#risk-analysis-tab"]');
            const newsTabPane = document.getElementById('news-analysis-tab');
            const riskTabPane = document.getElementById('risk-analysis-tab');
            
            if (newsTabBtn && riskTabBtn && newsTabPane && riskTabPane) {
                riskTabBtn.classList.add('active');
                newsTabBtn.classList.remove('active');
                riskTabPane.classList.add('show', 'active');
                newsTabPane.classList.remove('show', 'active');
            }
        }
    }

    /**
     * 解析AI回應內容
     */
    parseAIResponse(content, analysisType) {
        try {
            console.log('解析AI回應...');
            
            let score = 0;
            let summary = '';
            let factors = [];
            let isNewsAnalysis = analysisType === 'news';
            
            // 提取評分 - 嘗試多種匹配模式
            const scoreMatch = content.match(/評分[：:]\s*([+-]?\d+)/) || 
                             content.match(/([+-]?\d+)\s*分/) ||
                             content.match(/最終評分[：:]\s*([+-]?\d+)/) ||
                             content.match(/消息面評分[：:]\s*([+-]?\d+)/) ||
                             content.match(/風險面評分[：:]\s*([+-]?\d+)/);
            
            if (scoreMatch) {
                score = parseInt(scoreMatch[1]);
                if (isNaN(score) || score < -10 || score > 10) {
                    score = 0;
                }
            }
            
            // 提取重點總結
            const summaryMatch = content.match(/重點總結[：:]([\s\S]*?)(?=\n\n|$)/) ||
                               content.match(/總結[：:]([\s\S]*?)(?=\n\n|$)/) ||
                               content.match(/評語[：:]([\s\S]*?)(?=\n\n|$)/);
            
            if (summaryMatch) {
                summary = summaryMatch[1].trim();
                // 如果總結太長，截斷
                if (summary.length > 200) {
                    summary = summary.substring(0, 200) + '...';
                }
            } else {
                // 如果沒有找到總結，使用最後一段作為總結
                const paragraphs = content.split('\n\n').filter(p => p.trim().length > 20);
                if (paragraphs.length > 0) {
                    summary = paragraphs[paragraphs.length - 1].trim();
                    if (summary.length > 200) {
                        summary = summary.substring(0, 200) + '...';
                    }
                }
            }
            
            // 根據分析類型提取因素
            if (isNewsAnalysis) {
                // 嘗試提取市場消息面因素
                factors = this.extractSectionFactors(content, ['市場消息面', '消息面', '正面因素', '利多因素']);
            } else {
                // 嘗試提取風險面因素
                factors = this.extractSectionFactors(content, ['風險面', '風險因素', '負面因素', '利空因素']);
            }
            
            // 如果沒有提取到因素，嘗試從編號列表中提取
            if (factors.length === 0) {
                factors = this.extractNumberedItems(content).slice(0, 5);
            }
            
            // 如果還是沒有因素，使用默認值
            if (factors.length === 0) {
                factors = isNewsAnalysis ? 
                    ['市場關注度提升', '產業趨勢向好', '基本面穩健', '技術創新領先', '政策支持有利'] :
                    ['行業競爭加劇', '成本壓力上升', '政策風險存在', '市場需求波動', '技術迭代快速'];
            }
            
            return {
                score: score,
                summary: summary || `${isNewsAnalysis ? '市場消息面' : '風險面'}分析完成，評分: ${score}分`,
                factors: factors,
                rawContent: content
            };
            
        } catch (error) {
            console.error('解析AI回應錯誤:', error);
            return {
                score: 0,
                summary: '分析完成，請查看詳細內容',
                factors: ['詳細分析見完整報告'],
                rawContent: content
            };
        }
    }

    /**
     * 從特定章節提取因素
     */
    extractSectionFactors(content, sectionKeywords) {
        for (const keyword of sectionKeywords) {
            const regex = new RegExp(`${keyword}[：:]([\\s\\S]*?)(?=\\n\\n[A-Za-z\\u4e00-\\u9fff]{2,}|$)`, 'i');
            const match = content.match(regex);
            
            if (match) {
                return this.extractNumberedItems(match[1]).slice(0, 5);
            }
        }
        return [];
    }

    /**
     * 提取編號項目
     */
    extractNumberedItems(text) {
        const items = [];
        const lines = text.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            // 匹配多種編號格式: 1., 1、, (1), ① 等
            const numberedMatch = trimmed.match(/^(\d+[\.、]|\(\d+\)|[\u2460-\u2473]|[①②③④⑤⑥⑦⑧⑨⑩])\s+(.+)/);
            if (numberedMatch && numberedMatch[2].trim().length > 3) {
                items.push(numberedMatch[2].trim());
            }
            // 匹配項目符號
            else if (trimmed.match(/^[•\-*]\s+(.+)/)) {
                const item = trimmed.replace(/^[•\-*]\s+/, '').trim();
                if (item.length > 3) {
                    items.push(item);
                }
            }
        }
        
        return items;
    }

    /**
     * 顯示消息面分析
     */
    displayNewsAnalysis(parsedContent, stockName) {
        const score = parsedContent.score;
        const factors = parsedContent.factors;
        const summary = parsedContent.summary;
        
        // 更新評分顯示
        const scoreDisplay = document.getElementById('newsScoreDisplay');
        if (scoreDisplay) {
            scoreDisplay.textContent = score > 0 ? `+${score}` : score;
            scoreDisplay.className = `fs-1 fw-bold ${score > 0 ? 'text-success' : score < 0 ? 'text-danger' : 'text-warning'}`;
        }
        
        // 更新因素列表
        const factorsList = document.getElementById('newsFactorsList');
        if (factorsList) {
            factorsList.innerHTML = factors.map((factor, index) => 
                `<li class="list-group-item">${index + 1}. ${factor}</li>`
            ).join('');
        }
        
        // 更新總結
        const summaryEl = document.getElementById('newsSummary');
        if (summaryEl) {
            summaryEl.textContent = summary;
        }
        
        // 更新原始內容
        const rawContentEl = document.getElementById('newsRawContent');
        if (rawContentEl) {
            rawContentEl.textContent = parsedContent.rawContent;
        }
        
        // 更新應用評分按鈕的數據
        const applyBtn = document.getElementById('applyNewsScore');
        if (applyBtn) {
            applyBtn.dataset.score = score;
        }
    }

    /**
     * 顯示風險面分析
     */
    displayRiskAnalysis(parsedContent, stockName) {
        const score = parsedContent.score;
        const factors = parsedContent.factors;
        const summary = parsedContent.summary;
        
        // 更新評分顯示
        const scoreDisplay = document.getElementById('riskScoreDisplay');
        if (scoreDisplay) {
            scoreDisplay.textContent = score > 0 ? `+${score}` : score;
            scoreDisplay.className = `fs-1 fw-bold ${score > 0 ? 'text-success' : score < 0 ? 'text-danger' : 'text-warning'}`;
        }
        
        // 更新因素列表
        const factorsList = document.getElementById('riskFactorsList');
        if (factorsList) {
            factorsList.innerHTML = factors.map((factor, index) => 
                `<li class="list-group-item">${index + 1}. ${factor}</li>`
            ).join('');
        }
        
        // 更新總結
        const summaryEl = document.getElementById('riskSummary');
        if (summaryEl) {
            summaryEl.textContent = summary;
        }
        
        // 更新原始內容
        const rawContentEl = document.getElementById('riskRawContent');
        if (rawContentEl) {
            rawContentEl.textContent = parsedContent.rawContent;
        }
        
        // 更新應用評分按鈕的數據
        const applyBtn = document.getElementById('applyRiskScore');
        if (applyBtn) {
            applyBtn.dataset.score = score;
        }
    }

    /**
     * 保存分析歷史
     */
    saveAnalysisHistory(analysisType, data) {
        this.analysisHistory[analysisType] = data;
        console.log(`已保存 ${analysisType} 分析歷史`);
    }

    /**
     * 加載分析歷史
     */
    loadAnalysisHistory(analysisType) {
        return this.analysisHistory[analysisType];
    }

    /**
     * 清除分析結果
     */
    clearAnalysis() {
        this.analysisHistory = { news: null, risk: null };
        
        // 重置所有顯示元素
        const resetElements = [
            'newsScoreDisplay', 'newsFactorsList', 'newsSummary', 'newsRawContent',
            'riskScoreDisplay', 'riskFactorsList', 'riskSummary', 'riskRawContent'
        ];
        
        resetElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id.includes('ScoreDisplay')) {
                    el.textContent = '0';
                    el.className = 'fs-1 fw-bold text-warning';
                } else if (id.includes('List')) {
                    el.innerHTML = '';
                } else if (id.includes('Summary') || id.includes('RawContent')) {
                    el.textContent = '';
                }
            }
        });
        
        const resultDiv = document.getElementById('aiAnalysisResult');
        if (resultDiv) {
            resultDiv.style.display = 'none';
        }
    }
}

// 創建全局實例
if (typeof window !== 'undefined') {
    window.aiAnalysisDisplay = new AIAnalysisDisplay();
}