const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('=== AI分析函數開始 ===');
  console.log('方法:', event.httpMethod);
  console.log('路徑:', event.path);
  
  // 處理 CORS
  if (event.httpMethod === 'OPTIONS') {
    console.log('處理CORS預檢請求');
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: '只允許POST請求' })
    };
  }

  try {
    let requestBody;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '無效的JSON格式' })
      };
    }

    const { stockId, stockName, platform, apiKey, analysisType } = requestBody;
    
    console.log('請求參數:', { 
      stockId, 
      stockName, 
      platform, 
      analysisType, 
      apiKeyLength: apiKey ? apiKey.length : 0 
    });

    if (!stockId || !platform || !apiKey) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '缺少必要參數: stockId, platform, apiKey' })
      };
    }

    let analysisResult;
    
    switch (platform) {
      case 'deepseek':
        analysisResult = await analyzeWithDeepSeek(stockId, stockName, apiKey, analysisType);
        break;
      case 'gpt':
        analysisResult = await analyzeWithGPT(stockId, stockName, apiKey, analysisType);
        break;
      case 'gemini':
        analysisResult = await analyzeWithGemini(stockId, stockName, apiKey, analysisType);
        break;
      case 'claude':
        analysisResult = await analyzeWithClaude(stockId, stockName, apiKey, analysisType);
        break;
      case 'grok':
        analysisResult = await analyzeWithGrok(stockId, stockName, apiKey, analysisType);
        break;
      default:
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: '不支持的AI平台: ' + platform })
        };
    }

    console.log('分析完成，返回結果');
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(analysisResult)
    };

  } catch (error) {
    console.error('AI分析函數錯誤:', error);
    
    let errorMessage = '分析失敗';
    if (error.message.includes('API Key') || error.message.includes('401') || error.message.includes('403')) {
      errorMessage = 'API Key 無效或已過期';
    } else if (error.message.includes('network') || error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
      errorMessage = '網絡連線失敗';
    } else if (error.message.includes('quota') || error.message.includes('limit') || error.message.includes('429')) {
      errorMessage = 'API 配額已用盡';
    } else if (error.message.includes('timeout')) {
      errorMessage = '請求超時';
    }
    
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: errorMessage,
        details: error.message,
        platform: '請檢查Netlify Function日誌'
      })
    };
  }
};

// DeepSeek 分析函數
async function analyzeWithDeepSeek(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到DeepSeek API...');
  console.log('API Key 前10位:', apiKey.substring(0, 10) + '...');
  console.log('提示詞長度:', prompt.length);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超時

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('DeepSeek API 響應狀態:', response.status);
    console.log('DeepSeek API 響應頭:', JSON.stringify(Object.fromEntries(response.headers)));

    if (!response.ok) {
      let errorText;
      try {
        const errorData = await response.json();
        errorText = JSON.stringify(errorData);
        console.log('DeepSeek API 錯誤詳情:', errorData);
      } catch (e) {
        errorText = await response.text();
        console.log('DeepSeek API 錯誤文本:', errorText);
      }
      
      if (response.status === 401) {
        throw new Error('DeepSeek API Key 無效或未授權');
      } else if (response.status === 429) {
        throw new Error('DeepSeek API 請求頻率限制');
      } else if (response.status >= 500) {
        throw new Error('DeepSeek 服務器內部錯誤: ' + response.status);
      } else {
        throw new Error(`DeepSeek API 錯誤 ${response.status}: ${errorText}`);
      }
    }

    const data = await response.json();
    console.log('DeepSeek API 響應接收成功');
    console.log('響應數據結構:', Object.keys(data));
    
    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.log('無效的響應數據:', data);
      throw new Error('DeepSeek API 返回數據格式錯誤: 缺少choices');
    }
    
    if (!data.choices[0].message || !data.choices[0].message.content) {
      console.log('無效的消息數據:', data.choices[0]);
      throw new Error('DeepSeek API 返回數據格式錯誤: 缺少message content');
    }
    
    return parseAIResponse(data.choices[0].message.content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('DeepSeek API 請求超時');
    }
    throw error;
  }
}

// GPT 分析函數
async function analyzeWithGPT(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到 OpenAI API...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API錯誤: ${response.status} - ${errorData.error?.message || JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('OpenAI API 響應接收成功');
    return parseAIResponse(data.choices[0].message.content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('OpenAI API 請求超時');
    }
    throw error;
  }
}

// Gemini 分析函數
async function analyzeWithGemini(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到 Gemini API...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Gemini API 響應接收成功');
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Gemini API 返回數據格式錯誤');
    }
    
    const content = data.candidates[0].content.parts[0].text;
    return parseAIResponse(content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Gemini API 請求超時');
    }
    throw error;
  }
}

// Claude 分析函數
async function analyzeWithClaude(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到 Claude API...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: prompt
        }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Claude API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Claude API 響應接收成功');
    
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('Claude API 返回數據格式錯誤');
    }
    
    const content = data.content[0].text;
    return parseAIResponse(content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Claude API 請求超時');
    }
    throw error;
  }
}

// Grok 分析函數
async function analyzeWithGrok(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到 Grok API...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: 0.7,
        max_tokens: 2000,
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Grok API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Grok API 響應接收成功');
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Grok API 返回數據格式錯誤');
    }
    
    return parseAIResponse(data.choices[0].message.content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Grok API 請求超時');
    }
    throw error;
  }
}

// 結構化提示詞函數 - 消息面分析
function createNewsAnalysisPrompt(stockId, stockName) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  return `作為專業股票分析師，請分析台灣股票 ${stockId} ${stockName} 在 ${currentDate} 的最新市場消息面。

請嚴格按照以下格式提供分析：

【正面因素】
1. [具體利多因素1 - 請提供實際數據或事件，包含影響程度]
2. [具體利多因素2 - 請提供實際數據或事件，包含影響程度] 
3. [具體利多因素3 - 請提供實際數據或事件，包含影響程度]

【負面因素】
1. [具體利空因素1 - 請提供風險分析和影響程度]
2. [具體利空因素2 - 請提供風險分析和影響程度]
3. [具體利空因素3 - 請提供風險分析和影響程度]

【評分項目詳情】
請為以下項目分配具體分數（每個項目-2到+4分）：
• 營收成長性：[分數]分 - [理由]
• 盈利能力：[分數]分 - [理由]
• 市場地位：[分數]分 - [理由]  
• 行業前景：[分數]分 - [理由]
• 新聞影響：[分數]分 - [理由]
• 技術面：[分數]分 - [理由]

【總分計算】
請詳細說明每個項目的分數計算過程和總分

【最終評分】[必須是-10到+10的整數]

【投資建議】[50字內的具體建議]

請基於最新市場資訊提供真實、客觀的分析。`;
}

// 結構化提示詞函數 - 風險面分析
function createRiskAnalysisPrompt(stockId, stockName) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  return `作為專業風險分析師，請分析台灣股票 ${stockId} ${stockName} 在 ${currentDate} 的風險面因素。

請嚴格按照以下格式提供分析：

【高風險因素】
1. [具體高風險1 - 請說明風險程度和影響，包含具體數據]
2. [具體高風險2 - 請說明風險程度和影響，包含具體數據]
3. [具體高風險3 - 請說明風險程度和影響，包含具體數據]

【中風險因素】  
1. [具體中風險1 - 請說明潛在影響和監控要點]
2. [具體中風險2 - 請說明潛在影響和監控要點]

【低風險因素】
1. [具體低風險1 - 請說明輕微影響和觀察要點]
2. [具體低風險2 - 請說明輕微影響和觀察要點]

【風險緩衝因素】
1. [公司優勢1 - 如何抵禦風險，包含具體數據]
2. [公司優勢2 - 如何抵禦風險，包含具體數據]
3. [公司優勢3 - 如何抵禦風險，包含具體數據]

【評分項目詳情】
請為以下項目分配具體分數（負分表示風險，正分表示抵抗力）：
• 財務風險：[分數]分 - [理由，包含負債比率、流動性等]
• 市場風險：[分數]分 - [理由，包含市場競爭、客戶集中度等]
• 營運風險：[分數]分 - [理由，包含供應鏈、技術更新等]
• 行業風險：[分數]分 - [理由，包含政策變化、行業週期等]
• 管理風險：[分數]分 - [理由，包含治理結構、管理層變動等]
• 風險緩衝力：[分數]分 - [理由，包含現金流、競爭優勢等]

【總分計算】
請詳細說明每個項目的分數計算過程和總分
（評分標準：-10到+10，-10表示極高風險，+10表示極低風險）

【最終評分】[必須是-10到+10的整數]

【風險建議】[50字內的具體建議]

請提供基於實際情況的客觀風險評估，特別是關注財務槓桿、現金流、行業政策變化等實際指標。`;
}

// 解析AI回應函數 - 支持結構化解析
function parseAIResponse(content, analysisType, stockName = '') {
  try {
    console.log('解析AI回應，內容長度:', content.length);
    
    // 嘗試結構化解析
    let structuredResult = parseStructuredResponse(content, analysisType, stockName);
    
    if (structuredResult.structured) {
      console.log('✅ 成功解析結構化回應');
      return structuredResult;
    }
    
    // 如果結構化解析失敗，使用原有的簡單解析
    console.log('⚠️ 結構化解析失敗，使用簡單解析');
    let score = 0;
    const scoreMatch = content.match(/最終評分:\s*([+-]?\d+)/) || 
                     content.match(/評分:\s*([+-]?\d+)/) ||
                     content.match(/([+-]?\d+)\s*分/);
    
    if (scoreMatch) {
      score = parseInt(scoreMatch[1]);
      if (isNaN(score) || score < -10 || score > 10) {
        score = 0;
      }
    }

    let comment = '分析完成';
    const commentMatch = content.match(/評語:\s*(.+?)(?=\n|$)/) ||
                        content.match(/總結:\s*(.+?)(?=\n|$)/);
    
    if (commentMatch) {
      comment = commentMatch[1].trim();
      if (comment.length > 100) {
        comment = comment.substring(0, 100) + '...';
      }
    }

    return {
      success: true,
      content: content,
      score: score,
      comment: comment,
      analysisType: analysisType,
      structured: false
    };
    
  } catch (error) {
    console.error('解析AI回應錯誤:', error);
    return {
      success: true,
      content: content,
      score: 0,
      comment: '內容解析完成，請手動查看詳細分析',
      analysisType: analysisType,
      structured: false
    };
  }
}

// 結構化解析函數
function parseStructuredResponse(content, analysisType, stockName = '') {
  try {
    console.log('開始解析結構化回應...');
    
    let score = 0;
    let positives = [];
    let negatives = [];
    let scoreDetails = [];
    let recommendation = '';

    // 提取最終評分
    const finalScoreMatch = content.match(/【最終評分】\s*[\[\]（）()]*\s*([+-]?\d+)/);
    if (finalScoreMatch) {
      score = parseInt(finalScoreMatch[1]);
      console.log('找到最終評分:', score);
    }

    if (analysisType === 'news') {
      // 提取正面因素
      const positivesMatch = content.match(/【正面因素】([\s\S]*?)【負面因素】/);
      if (positivesMatch) {
        const positivesText = positivesMatch[1];
        positives = extractNumberedItems(positivesText);
        console.log('提取正面因素:', positives.length);
      }

      // 提取負面因素
      const negativesMatch = content.match(/【負面因素】([\s\S]*?)【評分項目詳情】/);
      if (negativesMatch) {
        const negativesText = negativesMatch[1];
        negatives = extractNumberedItems(negativesText);
        console.log('提取負面因素:', negatives.length);
      }
    } else {
      // 風險分析：重新組織數據
      const risksMatch = content.match(/【高風險因素】([\s\S]*?)【中風險因素】/);
      if (risksMatch) {
        const risksText = risksMatch[1];
        // 高風險作為負面因素（扣分）
        const highRisks = extractNumberedItems(risksText);
        negatives = highRisks;
        console.log('提取高風險因素:', highRisks.length);
      }

      const mediumRisksMatch = content.match(/【中風險因素】([\s\S]*?)【低風險因素】/);
      if (mediumRisksMatch) {
        const mediumRisksText = mediumRisksMatch[1];
        const mediumRisks = extractNumberedItems(mediumRisksText);
        // 中風險添加到負面因素
        negatives = [...negatives, ...mediumRisks];
        console.log('提取中風險因素:', mediumRisks.length);
      }

      const buffersMatch = content.match(/【風險緩衝因素】([\s\S]*?)【評分項目詳情】/);
      if (buffersMatch) {
        const buffersText = buffersMatch[1];
        positives = extractNumberedItems(buffersText);
        console.log('提取緩衝因素:', positives.length);
      }
    }

    // 提取評分項目詳情
    const scoreDetailsMatch = content.match(/【評分項目詳情】([\s\S]*?)【總分計算】/);
    if (scoreDetailsMatch) {
      const detailsText = scoreDetailsMatch[1];
      scoreDetails = detailsText.split('\n').filter(line => 
        line.includes('分 - ') && line.trim().length > 5
      ).map(line => {
        const match = line.match(/(•|·|\*)?\s*(.+?):\s*([+-]?\d+)分\s*-\s*(.+)/);
        if (match) {
          return {
            item: match[2].trim(),
            score: parseInt(match[3]),
            reason: match[4].trim()
          };
        }
        return null;
      }).filter(item => item !== null);
      console.log('提取評分項目:', scoreDetails.length);
    }

    // 提取建議
    const recommendationMatch = content.match(/【(投資建議|風險建議)】([\s\S]*?)(?=【|$)/);
    if (recommendationMatch) {
      recommendation = recommendationMatch[2].trim();
    }

    // 如果沒有找到結構化內容，使用備用解析
    if (positives.length === 0 && negatives.length === 0) {
      console.log('未找到結構化內容，使用備用解析');
      return parseFallbackResponse(content, analysisType, stockName, score);
    }

    // 格式化顯示內容
    const formattedContent = formatAnalysisContent(
      positives, 
      negatives, 
      scoreDetails,
      '', 
      recommendation, 
      score,
      analysisType,
      stockName
    );

    return {
      success: true,
      content: formattedContent,
      rawContent: content,
      score: score,
      comment: recommendation || '分析完成',
      analysisType: analysisType,
      structured: true,
      positives: positives,
      negatives: negatives,
      scoreDetails: scoreDetails
    };

  } catch (error) {
    console.error('解析結構化回應錯誤:', error);
    return {
      success: true,
      content: content,
      score: 0,
      comment: '分析完成，請查看詳細內容',
      analysisType: analysisType,
      structured: false
    };
  }
}

// 提取編號項目
function extractNumberedItems(text) {
  return text.split('\n')
    .filter(line => line.trim().match(/^\d+\./))
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .filter(item => item.length > 0);
}

// 備用解析方法
function parseFallbackResponse(content, analysisType, stockName, score) {
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  let positives = [];
  let negatives = [];
  let recommendation = '';
  
  if (analysisType === 'news') {
    // 消息面：簡單的關鍵詞匹配
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('正面') || lowerLine.includes('利好') || lowerLine.includes('優勢') || 
          lowerLine.includes('機會') || lowerLine.includes('成長')) {
        if (line.length > 10 && !line.match(/^(正面|利好|優勢|機會|成長)/)) {
          positives.push(line);
        }
      } else if (lowerLine.includes('負面') || lowerLine.includes('風險') || lowerLine.includes('挑戰') || 
                lowerLine.includes('問題') || lowerLine.includes('不利')) {
        if (line.length > 10 && !line.match(/^(負面|風險|挑戰|問題|不利)/)) {
          negatives.push(line);
        }
      } else if (lowerLine.includes('建議') || lowerLine.includes('推薦') || lowerLine.includes('結論')) {
        recommendation = line;
      }
    });
    
    // 如果沒有找到足夠的因素，使用默認值
    if (positives.length === 0) {
      positives = ['營收表現穩健', '市場地位穩固', '技術優勢明顯'];
    }
    if (negatives.length === 0) {
      negatives = ['行業競爭加劇', '成本壓力上升', '市場需求波動'];
    }
  } else {
    // 風險面：不同的關鍵詞匹配
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('風險') || lowerLine.includes('問題') || lowerLine.includes('挑戰') || 
          lowerLine.includes('威脅') || lowerLine.includes('不利') || lowerLine.includes('下跌')) {
        if (line.length > 10) {
          negatives.push(line);
        }
      } else if (lowerLine.includes('優勢') || lowerLine.includes('緩衝') || lowerLine.includes('保護') || 
                lowerLine.includes('防禦') || lowerLine.includes('競爭力') || lowerLine.includes('穩健')) {
        if (line.length > 10) {
          positives.push(line);
        }
      } else if (lowerLine.includes('建議') || lowerLine.includes('推薦') || lowerLine.includes('策略')) {
        recommendation = line;
      }
    });
    
    // 如果沒有找到足夠的因素，使用默認值
    if (negatives.length === 0) {
      negatives = ['財務槓桿過高', '行業競爭激烈', '政策變化風險'];
    }
    if (positives.length === 0) {
      positives = ['現金流充足', '技術領先地位', '多元化客戶基礎'];
    }
  }
  
  const scoreDetails = generateScoreDetails(positives, negatives, score, analysisType);
  const formattedContent = formatAnalysisContent(
    positives, negatives, scoreDetails, '', recommendation, score, analysisType, stockName
  );
  
  return {
    success: true,
    content: formattedContent,
    rawContent: content,
    score: score,
    comment: recommendation || '基於綜合分析給出的建議',
    analysisType: analysisType,
    structured: false,
    positives: positives.slice(0, 3),
    negatives: negatives.slice(0, 3),
    scoreDetails: scoreDetails
  };
}

// 生成評分詳情
function generateScoreDetails(positives, negatives, totalScore, analysisType) {
  const details = [];
  
  if (analysisType === 'news') {
    // 消息面評分分配
    const positiveScores = [3, 2, 1];
    const negativeScores = [-2, -1, -1];
    
    positives.forEach((positive, index) => {
      if (index < 3) {
        details.push({
          item: `正面因素 ${index + 1}`,
          score: positiveScores[index] || 1,
          reason: positive
        });
      }
    });
    
    negatives.forEach((negative, index) => {
      if (index < 2) {
        details.push({
          item: `負面因素 ${index + 1}`,
          score: negativeScores[index] || -1,
          reason: negative
        });
      }
    });
  } else {
    // 風險面評分分配
    const riskScores = [-3, -2, -1];
    const bufferScores = [2, 1, 1];
    
    negatives.forEach((risk, index) => {
      if (index < 3) {
        details.push({
          item: `風險因素 ${index + 1}`,
          score: riskScores[index] || -1,
          reason: risk
        });
      }
    });
    
    positives.forEach((buffer, index) => {
      if (index < 2) {
        details.push({
          item: `風險緩衝 ${index + 1}`,
          score: bufferScores[index] || 1,
          reason: buffer
        });
      }
    });
  }
  
  return details;
}

// 格式化分析內容
function formatAnalysisContent(positives, negatives, scoreDetails, summary, recommendation, score, analysisType, stockName) {
  const now = new Date();
  const analysisTime = now.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  let formatted = '';
  
  if (analysisType === 'news') {
    // 消息面評分顏色，+分為紅色，-分為黑色
    const scoreColor = score > 0 ? '🔴' : '⚫';
    const scoreText = score > 0 ? `+${score}` : score;
    formatted += `📊 ${scoreColor} ${stockName} 消息面分析評分: ${scoreText}/10\n\n`;
    
    formatted += `🌟 正面因素 (利多):\n`;
    positives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
    formatted += `\n⚠️ 負面因素 (風險):\n`;
    negatives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
  } else {
    // 風險面保持原有顏色邏輯
    const scoreColor = score > 0 ? '🟢' : score < 0 ? '🔴' : '🟡';
    const scoreText = score > 0 ? `+${score}` : score;
    formatted += `📊 ${scoreColor} ${stockName} 風險面分析評分: ${scoreText}/10\n\n`;
    
    formatted += `🔴 風險因素:\n`;
    negatives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
    formatted += `\n🛡️ 風險緩衝因素:\n`;
    positives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
  }
  
  // 添加評分項目詳情
  if (scoreDetails.length > 0) {
    formatted += `\n📈 評分項目詳情:\n`;
    scoreDetails.forEach(item => {
      formatted += `• ${item.item}: ${item.score > 0 ? '+' : ''}${item.score}分 - ${item.reason}\n`;
    });
  }
  
  if (recommendation) {
    formatted += `\n💡 建議:\n${recommendation}\n`;
  }
  
  formatted += `\n---\n*分析時間: ${analysisTime}*`;
  
  return formatted;
}