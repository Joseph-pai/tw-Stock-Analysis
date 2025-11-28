const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('AI分析函數被調用', event.httpMethod);
  
  // 處理 CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { stockId, stockName, platform, apiKey, analysisType } = JSON.parse(event.body || '{}');
    
    console.log(`AI分析請求: ${stockId} ${stockName}, 平台: ${platform}, 類型: ${analysisType}`);

    if (!stockId || !platform || !apiKey) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '缺少必要參數' })
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
          body: JSON.stringify({ error: '不支持的AI平台' })
        };
    }

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
    
    // 根據錯誤類型返回具體提示
    let errorMessage = '分析失敗';
    if (error.message.includes('API') || error.message.includes('401') || error.message.includes('403')) {
      errorMessage = 'API Key 無效或已過期';
    } else if (error.message.includes('network') || error.message.includes('fetch') || error.message.includes('timeout')) {
      errorMessage = '網絡連線失敗，請檢查網絡連接';
    } else if (error.message.includes('quota') || error.message.includes('limit')) {
      errorMessage = 'API 配額已用盡';
    }
    
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: errorMessage,
        details: error.message
      })
    };
  }
};

// DeepSeek 分析函數 - 真實實現
async function analyzeWithDeepSeek(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到DeepSeek API...');

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
    })
  });

  console.log('DeepSeek API 響應狀態:', response.status);

  if (!response.ok) {
    let errorText;
    try {
      const errorData = await response.json();
      errorText = errorData.error?.message || JSON.stringify(errorData);
    } catch {
      errorText = await response.text();
    }
    
    if (response.status === 401) {
      throw new Error('API Key 無效或未授權');
    } else if (response.status === 429) {
      throw new Error('API 請求頻率限制');
    } else if (response.status === 500) {
      throw new Error('DeepSeek 服務器內部錯誤');
    } else {
      throw new Error(`DeepSeek API 錯誤: ${response.status} - ${errorText}`);
    }
  }

  const data = await response.json();
  console.log('DeepSeek API 響應接收成功');
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('DeepSeek API 返回數據格式錯誤');
  }
  
  return parseAIResponse(data.choices[0].message.content, analysisType);
}

// GPT 分析函數
async function analyzeWithGPT(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`GPT API 錯誤: ${response.status} - ${errorData.error?.message || '未知錯誤'}`);
  }

  const data = await response.json();
  return parseAIResponse(data.choices[0].message.content, analysisType);
}

// Gemini 分析函數
async function analyzeWithGemini(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

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
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Gemini API 錯誤: ${response.status} - ${errorData.error?.message || '未知錯誤'}`);
  }

  const data = await response.json();
  const content = data.candidates[0].content.parts[0].text;
  return parseAIResponse(content, analysisType);
}

// Claude 分析函數
async function analyzeWithClaude(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

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
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Claude API 錯誤: ${response.status} - ${errorData.error?.message || '未知錯誤'}`);
  }

  const data = await response.json();
  return parseAIResponse(data.content[0].text, analysisType);
}

// Grok 分析函數
async function analyzeWithGrok(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Grok API 錯誤: ${response.status} - ${errorData.error?.message || '未知錯誤'}`);
  }

  const data = await response.json();
  return parseAIResponse(data.choices[0].message.content, analysisType);
}

// 創建消息面分析提示詞
function createNewsAnalysisPrompt(stockId, stockName) {
  return `你是一個專業的股票分析師。請分析台灣股票 ${stockId} ${stockName} 的最新市場消息面和新聞資訊面。

請嚴格按照以下結構提供分析結果：

📈 正面因素 (利多):
1. [具體的正面因素1，包含詳細說明和分析影響]
2. [具體的正面因素2，包含詳細說明和分析影響] 
3. [具體的正面因素3，包含詳細說明和分析影響]

⚠️ 負面/謹慎因素 (風險):
1. [具體的負面因素1，包含詳細說明和風險評估]
2. [具體的負面因素2，包含詳細說明和風險評估]
3. [具體的負面因素3，包含詳細說明和風險評估]

🔢 綜合評分計算:
請詳細說明每個因素的評分權重和計算過程，例如：
- 正面因素1: +3分 (原因...)
- 負面因素1: -2分 (原因...)
- 總計: X分

🎯 最終評分: [必須是-10到+10之間的整數]
💬 評語: [簡要的總結評語，50字以内]

請基於真實的市場新聞、分析師報告和行業動態進行客觀分析。`;
}

// 創建風險面分析提示詞
function createRiskAnalysisPrompt(stockId, stockName) {
  return `你是一個專業的風險分析師。請分析台灣股票 ${stockId} ${stockName} 的風險面因素。

請嚴格按照以下結構提供分析結果：

📉 負面風險因素 (扣分):
1. [具體的風險因素1，包含風險強度(高/中/低)和詳細分析]
2. [具體的風險因素2，包含風險強度(高/中/低)和詳細分析]
3. [具體的風險因素3，包含風險強度(高/中/低)和詳細分析]

🛡️ 風險緩衝因素 (加分/抵抗力):
1. [具體的緩衝因素1，包含抵抗力(強/中/弱)和詳細分析]
2. [具體的緩衝因素2，包含抵抗力(強/中/弱)和詳細分析] 
3. [具體的緩衝因素3，包含抵抗力(強/中/弱)和詳細分析]

🔢 綜合評分計算:
請詳細說明每個風險因素的評分權重和計算過程，例如：
- 風險因素1(高): -4分
- 緩衝因素1(強): +3分
- 總計: X分

🎯 最終評分: [必須是-10到+10之間的整數]
💬 評語: [簡要的風險總結評語，50字以内]

請從財務風險、市場風險、行業風險、地緣政治風險等多個維度進行全面分析。`;
}

// 解析AI回應
function parseAIResponse(content, analysisType) {
  try {
    console.log('解析AI回應，內容長度:', content.length);
    console.log('回應開頭:', content.substring(0, 300));

    // 提取最終評分 - 多種匹配模式
    let score = 0;
    const scoreMatches = [
      content.match(/最終評分:\s*([+-]?\d+)/),
      content.match(/最終評分\s*[：:]\s*([+-]?\d+)/),
      content.match(/評分:\s*([+-]?\d+)/),
      content.match(/([+-]?\d+)\s*分/),
      content.match(/([+-]?\d+)\s*$/m)
    ];
    
    for (const match of scoreMatches) {
      if (match) {
        score = parseInt(match[1]);
        if (!isNaN(score) && score >= -10 && score <= 10) {
          break;
        }
      }
    }

    // 如果沒有找到有效評分，嘗試從內容中推斷
    if (score === 0) {
      const positiveWords = content.match(/正面|利好|利多|看好|增長|成長|強勁|優於|突破/gi) || [];
      const negativeWords = content.match(/負面|利空|風險|謹慎|下跌|衰退|疲弱|低於|跌破/gi) || [];
      
      if (positiveWords.length > negativeWords.length + 2) score = 3;
      else if (negativeWords.length > positiveWords.length + 2) score = -3;
    }

    // 提取評語
    let comment = '分析完成';
    const commentMatches = [
      content.match(/評語:\s*(.+?)(?=\n|$)/),
      content.match(/評語\s*[：:]\s*(.+?)(?=\n|$/),
      content.match(/總結:\s*(.+?)(?=\n|$/),
      content.match(/分析[：:]\s*(.+?)(?=\n|$)/)
    ];
    
    for (const match of commentMatches) {
      if (match) {
        comment = match[1].trim();
        if (comment.length > 0) break;
      }
    }

    // 限制評語長度
    if (comment.length > 100) {
      comment = comment.substring(0, 100) + '...';
    }

    return {
      success: true,
      content: content,
      score: score,
      comment: comment,
      analysisType: analysisType,
      parsed: true
    };
  } catch (error) {
    console.error('解析AI回應錯誤:', error);
    return {
      success: true,
      content: content,
      score: 0,
      comment: '內容解析完成，請手動查看詳細分析',
      analysisType: analysisType,
      parsed: false
    };
  }
}