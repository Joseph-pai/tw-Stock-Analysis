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

    const { 
      stockId, 
      stockName, 
      platform, 
      apiKey, 
      analysisType,
      isParallelRequest = false  // 新增：標記是否為並行請求的一部分
    } = requestBody;
    
    console.log('請求參數:', { 
      stockId, 
      stockName, 
      platform, 
      analysisType, 
      isParallelRequest,
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
        analysisResult = await analyzeWithDeepSeek(stockId, stockName, apiKey, analysisType, isParallelRequest);
        break;
      case 'gpt':
        analysisResult = await analyzeWithGPT(stockId, stockName, apiKey, analysisType, isParallelRequest);
        break;
      case 'gemini':
        analysisResult = await analyzeWithGemini(stockId, stockName, apiKey, analysisType, isParallelRequest);
        break;
      case 'claude':
        analysisResult = await analyzeWithClaude(stockId, stockName, apiKey, analysisType, isParallelRequest);
        break;
      case 'grok':
        analysisResult = await analyzeWithGrok(stockId, stockName, apiKey, analysisType, isParallelRequest);
        break;
      default:
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: '不支持的AI平台: ' + platform })
        };
    }

    console.log(`✅ ${analysisType}分析完成，返回結果`);
    
    // 如果是並行請求，在結果中添加標記
    const responseData = isParallelRequest ? {
      ...analysisResult,
      analysisType: analysisType,
      isParallelResult: true
    } : analysisResult;

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(responseData)
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

// DeepSeek 分析函數（優化支持並行請求）
async function analyzeWithDeepSeek(stockId, stockName, apiKey, analysisType, isParallelRequest = false) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log(`發送${analysisType}請求到DeepSeek API...`);
  console.log('分析類型:', analysisType);
  console.log('並行請求:', isParallelRequest);
  console.log('提示詞長度:', prompt.length);

  // 根據是否並行請求調整超時時間
  const timeoutDuration = isParallelRequest ? 45000 : 55000; // 並行時減少超時時間
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`${analysisType}分析 DeepSeek API 請求超時`);
    controller.abort();
  }, timeoutDuration);

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
        max_tokens: 1500, // 統一設置為1500 tokens
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`${analysisType}分析 DeepSeek API 響應狀態:`, response.status);
    
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
        throw new Error(`DeepSeek 服務器內部錯誤: ${response.status}`);
      } else {
        throw new Error(`DeepSeek API 錯誤 ${response.status}: ${errorText}`);
      }
    }

    const data = await response.json();
    console.log(`${analysisType}分析 DeepSeek API 響應接收成功`);
    
    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      throw new Error('DeepSeek API 返回數據格式錯誤: 缺少choices');
    }
    
    if (!data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('DeepSeek API 返回數據格式錯誤: 缺少message content');
    }
    
    return parseAIResponse(data.choices[0].message.content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`${analysisType}分析 DeepSeek API 請求超時 (${timeoutDuration}毫秒)`);
    }
    console.error(`${analysisType}分析 DeepSeek 錯誤:`, error.message);
    throw error;
  }
}

// GPT 分析函數
async function analyzeWithGPT(stockId, stockName, apiKey, analysisType, isParallelRequest = false) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log(`發送${analysisType}請求到 OpenAI API...`);

  const timeoutDuration = isParallelRequest ? 45000 : 55000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

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
        max_tokens: 1500,
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
    console.log(`${analysisType}分析 OpenAI API 響應接收成功`);
    return parseAIResponse(data.choices[0].message.content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`${analysisType}分析 OpenAI API 請求超時`);
    }
    throw error;
  }
}

// Gemini 分析函數
async function analyzeWithGemini(stockId, stockName, apiKey, analysisType, isParallelRequest = false) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log(`發送${analysisType}請求到 Gemini API...`);

  const timeoutDuration = isParallelRequest ? 45000 : 55000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

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
          maxOutputTokens: 1500
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
    console.log(`${analysisType}分析 Gemini API 響應接收成功`);
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Gemini API 返回數據格式錯誤');
    }
    
    const content = data.candidates[0].content.parts[0].text;
    return parseAIResponse(content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`${analysisType}分析 Gemini API 請求超時`);
    }
    throw error;
  }
}

// Claude 分析函數
async function analyzeWithClaude(stockId, stockName, apiKey, analysisType, isParallelRequest = false) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log(`發送${analysisType}請求到 Claude API...`);

  const timeoutDuration = isParallelRequest ? 45000 : 55000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

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
        max_tokens: 1500,
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
    console.log(`${analysisType}分析 Claude API 響應接收成功`);
    
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('Claude API 返回數據格式錯誤');
    }
    
    const content = data.content[0].text;
    return parseAIResponse(content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`${analysisType}分析 Claude API 請求超時`);
    }
    throw error;
  }
}

// Grok 分析函數
async function analyzeWithGrok(stockId, stockName, apiKey, analysisType, isParallelRequest = false) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log(`發送${analysisType}請求到 Grok API...`);

  const timeoutDuration = isParallelRequest ? 45000 : 55000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

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
        max_tokens: 1500,
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
    console.log(`${analysisType}分析 Grok API 響應接收成功`);
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Grok API 返回數據格式錯誤');
    }
    
    return parseAIResponse(data.choices[0].message.content, analysisType, stockName);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`${analysisType}分析 Grok API 請求超時`);
    }
    throw error;
  }
}

// 結構化提示詞函數 - 消息面分析（優化版本）
function createNewsAnalysisPrompt(stockId, stockName) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  return `作為專業股票分析師，請簡潔分析台灣股票 ${stockId} ${stockName} 的最新市場消息面。

請按以下格式提供分析：

【正面因素】
1. [具體利多1，簡要說明]
2. [具體利多2，簡要說明]

【負面因素】
1. [具體利空1，簡要說明]
2. [具體利空2，簡要說明]

【評分項目】
• 營收成長性：[分數]分 - [簡要理由]
• 盈利能力：[分數]分 - [簡要理由]

【最終評分】[必須是-10到+10的整數]

【投資建議】[30字內建議]

請基於最新市場資訊提供簡潔、客觀的分析。`;
}

// 結構化提示詞函數 - 風險面分析（優化版本）
function createRiskAnalysisPrompt(stockId, stockName) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  return `作為風險分析師，請簡潔分析台灣股票 ${stockId} ${stockName} 的風險面因素。

請按以下格式提供分析：

【主要風險】
1. [高風險1，簡要說明]
2. [中風險1，簡要說明]

【風險緩衝】
1. [公司優勢1，簡要說明]
2. [公司優勢2，簡要說明]

【評分項目】
• 財務風險：[分數]分 - [簡要理由]
• 市場風險：[分數]分 - [簡要理由]

【最終評分】[必須是-10到+10的整數]

【風險建議】[30字內建議]

請提供簡潔的風險評估，重點關注財務數據和市場地位。`;
}

// 解析AI回應函數 - 支持結構化解析
function parseAIResponse(content, analysisType, stockName = '') {
  try {
    console.log(`解析${analysisType} AI回應，內容長度:`, content.length);
    
    // 嘗試結構化解析
    let structuredResult = parseStructuredResponse(content, analysisType, stockName);
    
    if (structuredResult.structured) {
      console.log(`✅ 成功解析${analysisType}結構化回應`);
      return structuredResult;
    }
    
    // 如果結構化解析失敗，使用簡單解析
    console.log(`⚠️ ${analysisType}結構化解析失敗，使用簡單解析`);
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
    console.error(`解析${analysisType} AI回應錯誤:`, error);
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
    console.log(`開始解析${analysisType}結構化回應...`);
    
    let score = 0;
    let positives = [];
    let negatives = [];
    let scoreDetails = [];
    let recommendation = '';

    // 提取最終評分
    const finalScoreMatch = content.match(/【最終評分】\s*[\[\]（）()]*\s*([+-]?\d+)/);
    if (finalScoreMatch) {
      score = parseInt(finalScoreMatch[1]);
      console.log(`找到${analysisType}最終評分:`, score);
    }

    if (analysisType === 'news') {
      // 提取正面因素
      const positivesMatch = content.match(/【正面因素】([\s\S]*?)【負面因素】/);
      if (positivesMatch) {
        const positivesText = positivesMatch[1];
        positives = extractNumberedItems(positivesText);
        console.log(`提取${analysisType}正面因素:`, positives.length);
      }

      // 提取負面因素
      const negativesMatch = content.match(/【負面因素】([\s\S]*?)【評分項目/);
      if (negativesMatch) {
        const negativesText = negativesMatch[1];
        negatives = extractNumberedItems(negativesText);
        console.log(`提取${analysisType}負面因素:`, negatives.length);
      }
    } else {
      // 風險分析
      const risksMatch = content.match(/【主要風險】([\s\S]*?)【風險緩衝】/);
      if (risksMatch) {
        const risksText = risksMatch[1];
        negatives = extractNumberedItems(risksText);
        console.log(`提取${analysisType}風險因素:`, negatives.length);
      }

      const buffersMatch = content.match(/【風險緩衝】([\s\S]*?)【評分項目/);
      if (buffersMatch) {
        const buffersText = buffersMatch[1];
        positives = extractNumberedItems(buffersText);
        console.log(`提取${analysisType}緩衝因素:`, positives.length);
      }
    }

    // 提取評分項目詳情
    const scoreDetailsMatch = content.match(/【評分項目】([\s\S]*?)【最終評分】/);
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
      console.log(`提取${analysisType}評分項目:`, scoreDetails.length);
    }

    // 提取建議
    const recommendationMatch = content.match(/【(投資建議|風險建議)】([\s\S]*?)(?=【|$)/);
    if (recommendationMatch) {
      recommendation = recommendationMatch[2].trim();
    }

    // 如果沒有找到結構化內容，使用備用解析
    if (positives.length === 0 && negatives.length === 0) {
      console.log(`未找到${analysisType}結構化內容，使用備用解析`);
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
    console.error(`解析${analysisType}結構化回應錯誤:`, error);
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
        if (line.length > 8 && !line.match(/^(正面|利好|優勢|機會|成長)/)) {
          positives.push(line);
        }
      } else if (lowerLine.includes('負面') || lowerLine.includes('風險') || lowerLine.includes('挑戰') || 
                lowerLine.includes('問題') || lowerLine.includes('不利')) {
        if (line.length > 8 && !line.match(/^(負面|風險|挑戰|問題|不利)/)) {
          negatives.push(line);
        }
      } else if (lowerLine.includes('建議') || lowerLine.includes('推薦') || lowerLine.includes('結論')) {
        recommendation = line;
      }
    });
    
    // 如果沒有找到足夠的因素，使用默認值
    if (positives.length === 0) {
      positives = ['營收表現穩健', '市場地位穩固'];
    }
    if (negatives.length === 0) {
      negatives = ['行業競爭加劇', '成本壓力上升'];
    }
  } else {
    // 風險面：不同的關鍵詞匹配
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('風險') || lowerLine.includes('問題') || lowerLine.includes('挑戰') || 
          lowerLine.includes('威脅') || lowerLine.includes('不利') || lowerLine.includes('下跌')) {
        if (line.length > 8) {
          negatives.push(line);
        }
      } else if (lowerLine.includes('優勢') || lowerLine.includes('緩衝') || lowerLine.includes('保護') || 
                lowerLine.includes('防禦') || lowerLine.includes('競爭力') || lowerLine.includes('穩健')) {
        if (line.length > 8) {
          positives.push(line);
        }
      } else if (lowerLine.includes('建議') || lowerLine.includes('推薦') || lowerLine.includes('策略')) {
        recommendation = line;
      }
    });
    
    // 如果沒有找到足夠的因素，使用默認值
    if (negatives.length === 0) {
      negatives = ['財務槓桿過高', '行業競爭激烈'];
    }
    if (positives.length === 0) {
      positives = ['現金流充足', '技術領先地位'];
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
    positives: positives.slice(0, 2),
    negatives: negatives.slice(0, 2),
    scoreDetails: scoreDetails
  };
}

// 生成評分詳情
function generateScoreDetails(positives, negatives, totalScore, analysisType) {
  const details = [];
  
  if (analysisType === 'news') {
    // 消息面評分分配
    const positiveScores = [2, 1];
    const negativeScores = [-1, -1];
    
    positives.forEach((positive, index) => {
      if (index < 2) {
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
    const riskScores = [-2, -1];
    const bufferScores = [2, 1];
    
    negatives.forEach((risk, index) => {
      if (index < 2) {
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