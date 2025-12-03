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
    
    console.log('請求參數:', { stockId, platform, analysisType, apiKeyLength: apiKey ? apiKey.length : 0 });

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
    
    return parseAIResponse(data.choices[0].message.content, analysisType);
    
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
    return parseAIResponse(data.choices[0].message.content, analysisType);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('OpenAI API 請求超時');
    }
    throw error;
  }
}

// Gemini 分析函數 - 已修正
async function analyzeWithGemini(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到 Gemini API...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    // 使用最新的 Gemini API 端點和模型
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
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
          maxOutputTokens: 2000,
          topP: 0.8,
          topK: 40
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE"
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API錯誤詳情:', errorData);
      
      // 針對 404 錯誤提供更具體的建議
      if (response.status === 404) {
        throw new Error(`Gemini API錯誤 404: 模型可能不存在。請嘗試使用 gemini-1.5-flash 或其他可用模型`);
      }
      
      throw new Error(`Gemini API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Gemini API 響應接收成功');
    console.log('Gemini API 響應結構:', Object.keys(data));
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      console.error('Gemini API 返回數據格式錯誤:', data);
      throw new Error('Gemini API 返回數據格式錯誤：缺少必要字段');
    }
    
    const content = data.candidates[0].content.parts[0].text;
    console.log('Gemini 回應內容長度:', content.length);
    
    return parseAIResponse(content, analysisType);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Gemini API 請求超時');
    }
    
    // 如果 gemini-1.5-pro 失敗，嘗試 gemini-1.5-flash
    if (error.message.includes('404') || error.message.includes('模型可能不存在')) {
      console.log('嘗試使用 gemini-1.5-flash 模型...');
      try {
        return await analyzeWithGeminiFlash(stockId, stockName, apiKey, analysisType);
      } catch (flashError) {
        throw new Error(`Gemini API 全部嘗試失敗: ${error.message}, Flash模型錯誤: ${flashError.message}`);
      }
    }
    
    throw error;
  }
}

// 備用 Gemini Flash 分析函數
async function analyzeWithGeminiFlash(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到 Gemini Flash API...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    // 使用 gemini-1.5-flash 模型
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
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
          maxOutputTokens: 2000,
          topP: 0.8,
          topK: 40
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE"
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini Flash API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Gemini Flash API 響應接收成功');
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      throw new Error('Gemini Flash API 返回數據格式錯誤');
    }
    
    const content = data.candidates[0].content.parts[0].text;
    return parseAIResponse(content, analysisType);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Gemini Flash API 請求超時');
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
    return parseAIResponse(content, analysisType);
    
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
    
    return parseAIResponse(data.choices[0].message.content, analysisType);
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Grok API 請求超時');
    }
    throw error;
  }
}

// 提示詞函數
function createNewsAnalysisPrompt(stockId, stockName) {
  return `請分析台灣股票 ${stockId} ${stockName} 的最新市場消息面和新聞資訊面。

請按照以下結構提供分析結果：

📈 正面因素 (利多):
1. [具體的正面因素1，包含詳細說明和分析影響]
2. [具體的正面因素2，包含詳細說明和分析影響] 

⚠️ 負面/謹慎因素 (風險):
1. [具體的負面因素1，包含詳細說明和風險評估]
2. [具體的負面因素2，包含詳細說明和風險評估]

🔢 綜合評分計算:
請詳細說明每個因素的評分權重和計算過程

🎯 最終評分: [必須是-10到+10之間的整數]
💬 評語: [簡要的總結評語]

請基於真實的市場情況進行客觀分析。`;
}

function createRiskAnalysisPrompt(stockId, stockName) {
  return `請分析台灣股票 ${stockId} ${stockName} 的風險面因素。

請按照以下結構提供分析結果：

📉 負面風險因素 (扣分):
1. [具體的風險因素1，包含風險強度和詳細分析]
2. [具體的風險因素2，包含風險強度和詳細分析]

🛡️ 風險緩衝因素 (加分/抵抗力):
1. [具體的緩衝因素1，包含抵抗力和詳細分析]
2. [具體的緩衝因素2，包含抵抗力和詳細分析]

🔢 綜合評分計算:
請詳細說明每個風險因素的評分權重和計算過程

🎯 最終評分: [必須是-10到+10之間的整數]
💬 評語: [簡要的風險總結評語]

請從多個維度進行全面分析。`;
}

// 解析AI回應函數
function parseAIResponse(content, analysisType) {
  try {
    console.log('解析AI回應，內容長度:', content.length);
    console.log('回應開頭:', content.substring(0, 200));

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
      analysisType: analysisType
    };
  } catch (error) {
    console.error('解析AI回應錯誤:', error);
    return {
      success: true,
      content: content,
      score: 0,
      comment: '內容解析完成，請手動查看詳細分析',
      analysisType: analysisType
    };
  }
}