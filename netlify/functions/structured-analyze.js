const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('=== 結構化分析開始 ===');
  
  try {
    const { stockId, stockName, apiKey, analysisType, platform = 'deepseek' } = JSON.parse(event.body || '{}');
    
    console.log(`結構化分析: ${stockId} ${stockName}, 類型: ${analysisType}, 平台: ${platform}`);

    if (!stockId || !apiKey) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '缺少必要參數' })
      };
    }

    let analysisResult;
    
    // 根據平台選擇不同的分析函數
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(analysisResult)
    };

  } catch (error) {
    console.error('結構化分析錯誤:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: error.message
      })
    };
  }
};

// DeepSeek 結構化分析
async function analyzeWithDeepSeek(stockId, stockName, apiKey, analysisType) {
  const prompt = createStructuredPrompt(stockId, stockName, analysisType);

  console.log('發送結構化請求到DeepSeek API...');

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  console.log('DeepSeek API響應狀態:', response.status);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`DeepSeek API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  console.log('DeepSeek回應內容:', content.substring(0, 500));

  // 解析結構化回應
  const parsedResult = parseStructuredResponse(content, analysisType, stockName);

  return parsedResult;
}

// GPT 結構化分析
async function analyzeWithGPT(stockId, stockName, apiKey, analysisType) {
  const prompt = createStructuredPrompt(stockId, stockName, analysisType);

  console.log('發送結構化請求到OpenAI API...');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  console.log('OpenAI API響應狀態:', response.status);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`OpenAI API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  console.log('OpenAI回應內容:', content.substring(0, 500));

  const parsedResult = parseStructuredResponse(content, analysisType, stockName);
  return parsedResult;
}

// Gemini 結構化分析 - 修復版本
async function analyzeWithGemini(stockId, stockName, apiKey, analysisType) {
  const prompt = createStructuredPrompt(stockId, stockName, analysisType);

  console.log('發送結構化請求到Gemini API...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超時

  try {
    // 嘗試多個可能的模型名稱
    const modelsToTry = [
      'gemini-1.5-pro',      // 新版本
      'gemini-1.5-flash',    // 快速版本
      'gemini-pro',          // 原始版本
      'models/gemini-pro'    // 完整路徑
    ];

    let lastError = null;
    
    for (const model of modelsToTry) {
      try {
        console.log(`嘗試 Gemini 模型: ${model}`);
        
        // 構建API端點
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
        
        const response = await fetch(apiUrl, {
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
            }
          }),
          signal: controller.signal
        });

        console.log(`Gemini API (${model}) 響應狀態:`, response.status);

        if (!response.ok) {
          const errorData = await response.json();
          console.log(`Gemini API (${model}) 錯誤:`, errorData);
          
          if (response.status !== 404) {
            // 如果不是404錯誤，直接拋出
            throw new Error(`Gemini API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
          }
          
          // 如果是404錯誤，記錄並嘗試下一個模型
          lastError = errorData;
          continue;
        }

        const data = await response.json();
        console.log(`Gemini API (${model}) 響應數據結構:`, Object.keys(data));
        
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
          console.error('Gemini API返回數據格式錯誤:', data);
          throw new Error('Gemini API返回數據格式錯誤：缺少必要字段');
        }
        
        const content = data.candidates[0].content.parts[0].text;
        console.log('Gemini回應內容長度:', content.length);
        console.log('Gemini回應內容:', content.substring(0, 500));

        const parsedResult = parseStructuredResponse(content, analysisType, stockName);
        
        // 清空超時並返回成功結果
        clearTimeout(timeoutId);
        return parsedResult;
        
      } catch (modelError) {
        console.log(`模型 ${model} 失敗:`, modelError.message);
        lastError = modelError;
        // 繼續嘗試下一個模型
        continue;
      }
    }

    // 所有模型都失敗了
    throw new Error(`所有Gemini模型嘗試失敗。最後錯誤: ${lastError ? lastError.message : '未知錯誤'}`);

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Gemini API請求超時');
    }
    
    // 如果所有嘗試都失敗，提供用戶可用的模型列表
    console.log('嘗試獲取可用的Gemini模型列表...');
    try {
      const modelsResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        signal: controller.signal
      });
      
      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json();
        const availableModels = modelsData.models ? modelsData.models.map(m => m.name).join(', ') : '無法獲取模型列表';
        throw new Error(`Gemini API連接失敗。可用模型: ${availableModels}\n原始錯誤: ${error.message}`);
      }
    } catch (modelsError) {
      console.log('獲取模型列表失敗:', modelsError.message);
    }
    
    throw error;
  }
}

// Claude 結構化分析
async function analyzeWithClaude(stockId, stockName, apiKey, analysisType) {
  const prompt = createStructuredPrompt(stockId, stockName, analysisType);

  console.log('發送結構化請求到Claude API...');

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
    })
  });

  console.log('Claude API響應狀態:', response.status);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Claude API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  console.log('Claude回應內容:', content.substring(0, 500));

  const parsedResult = parseStructuredResponse(content, analysisType, stockName);
  return parsedResult;
}

// Grok 結構化分析
async function analyzeWithGrok(stockId, stockName, apiKey, analysisType) {
  const prompt = createStructuredPrompt(stockId, stockName, analysisType);

  console.log('發送結構化請求到Grok API...');

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
    })
  });

  console.log('Grok API響應狀態:', response.status);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Grok API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  console.log('Grok回應內容:', content.substring(0, 500));

  const parsedResult = parseStructuredResponse(content, analysisType, stockName);
  return parsedResult;
}

// 創建結構化提示詞
function createStructuredPrompt(stockId, stockName, analysisType) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  
  if (analysisType === 'news') {
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
  } else {
    return `作為專業風險分析師，請分析台灣股票 ${stockId} ${stockName} 在 ${currentDate} 的風險面因素。

請嚴格按照以下格式提供分析：

【高風險因素】
1. [具體高風險1 - 請說明風險程度和影響，包含具體數據]
2. [具體高風險2 - 請說明風險程度和影響，包含具體數據]

【中風險因素】  
1. [具體中風險1 - 請說明潛在影響和監控要點]
2. [具體中風險2 - 請說明潛在影響和監控要點]

【風險緩衝因素】
1. [公司優勢1 - 如何抵禦風險，包含具體數據]
2. [公司優勢2 - 如何抵禦風險，包含具體數據]

【評分項目詳情】
請為以下項目分配具體分數（負分表示風險，正分表示抵抗力）：
• 財務風險：[分數]分 - [理由]
• 市場風險：[分數]分 - [理由]
• 營運風險：[分數]分 - [理由]
• 行業風險：[分數]分 - [理由]
• 管理風險：[分數]分 - [理由]
• 風險緩衝：[分數]分 - [理由]

【總分計算】
請詳細說明每個項目的分數計算過程和總分

【最終評分】[必須是-10到+10的整數]

【風險建議】[50字內的具體建議]

請提供基於實際情況的客觀風險評估。`;
  }
}

// 解析結構化回應
function parseStructuredResponse(content, analysisType, stockName) {
  try {
    console.log('開始解析結構化回應...');
    
    let score = 0;
    let positives = [];
    let negatives = [];
    let scoreDetails = [];
    let summary = '';
    let recommendation = '';

    // 提取最終評分
    const finalScoreMatch = content.match(/【最終評分】\s*[\[\]（）()]*\s*([+-]?\d+)/);
    if (finalScoreMatch) {
      score = parseInt(finalScoreMatch[1]);
      console.log('找到最終評分:', score);
    }

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

    // 提取風險因素（風險面分析）
    if (analysisType === 'risk') {
      const risksMatch = content.match(/【高風險因素】([\s\S]*?)【中風險因素】/);
      if (risksMatch) {
        const risksText = risksMatch[1];
        positives = extractNumberedItems(risksText);
        console.log('提取風險因素:', positives.length);
      }

      const buffersMatch = content.match(/【風險緩衝因素】([\s\S]*?)【評分項目詳情】/);
      if (buffersMatch) {
        const buffersText = buffersMatch[1];
        negatives = extractNumberedItems(buffersText);
        console.log('提取緩衝因素:', negatives.length);
      }
    }

    // 提取評分項目詳情
    const scoreDetailsMatch = content.match(/【評分項目詳情】([\s\S]*?)【總分計算】/);
    if (scoreDetailsMatch) {
      const detailsText = scoreDetailsMatch[1];
      scoreDetails = detailsText.split('\n').filter(line => 
        line.includes('分 - ') && line.trim().length > 5
      ).map(line => {
        const match = line.match(/•\s*(.+?):\s*([+-]?\d+)分\s*-\s*(.+)/);
        if (match) {
          return {
            item: match[1].trim(),
            score: parseInt(match[2]),
            reason: match[3].trim()
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
      summary, 
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
  
  // 簡單的關鍵詞匹配
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
    
    positives.forEach((risk, index) => {
      if (index < 3) {
        details.push({
          item: `風險因素 ${index + 1}`,
          score: riskScores[index] || -1,
          reason: risk
        });
      }
    });
    
    negatives.forEach((buffer, index) => {
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
    formatted += `📊 ${score > 0 ? '🟢' : score < 0 ? '🔴' : '🟡'} ${stockName} 消息面分析評分: ${score > 0 ? '+' : ''}${score}/10\n\n`;
    
    formatted += `🌟 正面因素 (利多):\n`;
    positives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
    formatted += `\n⚠️ 負面因素 (風險):\n`;
    negatives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
  } else {
    formatted += `📊 ${score > 0 ? '🟢' : score < 0 ? '🔴' : '🟡'} ${stockName} 風險面分析評分: ${score > 0 ? '+' : ''}${score}/10\n\n`;
    
    formatted += `🔴 風險因素:\n`;
    positives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
    formatted += `\n🛡️ 風險緩衝因素:\n`;
    negatives.forEach((item, index) => {
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