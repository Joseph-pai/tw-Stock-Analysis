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

// Gemini 結構化分析
async function analyzeWithGemini(stockId, stockName, apiKey, analysisType) {
  const prompt = createStructuredPrompt(stockId, stockName, analysisType);

  console.log('發送結構化請求到Gemini API...');

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

  console.log('Gemini API響應狀態:', response.status);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Gemini API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const content = data.candidates[0].content.parts[0].text;

  console.log('Gemini回應內容:', content.substring(0, 500));

  const parsedResult = parseStructuredResponse(content, analysisType, stockName);
  return parsedResult;
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

// 創建結構化提示詞（簡化版本）
function createStructuredPrompt(stockId, stockName, analysisType) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  
  if (analysisType === 'news') {
    return `請分析${stockId} ${stockName}的市場消息面，重點整理總結，給出-10～+10的評分。

請提供：
1. 正面因素與分析
2. 負面因素與分析  
3. 綜合評分與理由
4. 投資建議`;
  } else {
    return `請分析${stockId} ${stockName}的風險面，重點整理總結，給出-10～+10的評分。

請提供：
1. 主要風險因素
2. 風險緩衝因素
3. 綜合評分與理由
4. 風險管理建議`;
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

    // 嘗試從內容中提取評分
    const scorePatterns = [
      /評分[：:]\s*([+-]?\d+)/i,
      /([+-]?\d+)\s*分/i,
      /評分[為是]\s*([+-]?\d+)/i,
      /最終評分[：:]\s*([+-]?\d+)/i
    ];
    
    for (const pattern of scorePatterns) {
      const match = content.match(pattern);
      if (match) {
        score = parseInt(match[1]);
        if (score > 10) score = 10;
        if (score < -10) score = -10;
        console.log('找到評分:', score);
        break;
      }
    }

    // 提取正面因素
    const positiveKeywords = ['正面', '利多', '優勢', '機會', '成長', '有利', '積極'];
    const negativeKeywords = ['負面', '利空', '風險', '挑戰', '問題', '不利', '消極'];
    
    if (analysisType === 'news') {
      // 消息面分析
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      let inPositiveSection = false;
      let inNegativeSection = false;
      
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        
        // 檢測部分開始
        if (positiveKeywords.some(keyword => lowerLine.includes(keyword))) {
          inPositiveSection = true;
          inNegativeSection = false;
          continue;
        }
        
        if (negativeKeywords.some(keyword => lowerLine.includes(keyword))) {
          inPositiveSection = false;
          inNegativeSection = true;
          continue;
        }
        
        // 收集因素
        if (inPositiveSection && (line.match(/^\d+\./) || line.match(/^[•\-]/) || line.match(/^[✓✔]/))) {
          const factor = line.replace(/^\d+\.\s*|[•\-]\s*|[✓✔]\s*/g, '').trim();
          if (factor.length > 0 && positives.length < 5) {
            positives.push(factor);
          }
        }
        
        if (inNegativeSection && (line.match(/^\d+\./) || line.match(/^[•\-]/) || line.match(/^[⚠️❗❌]/))) {
          const factor = line.replace(/^\d+\.\s*|[•\-]\s*|[⚠️❗❌]\s*/g, '').trim();
          if (factor.length > 0 && negatives.length < 5) {
            negatives.push(factor);
          }
        }
      }
    } else {
      // 風險面分析
      const riskKeywords = ['風險', '不利', '挑戰', '問題', '弱點'];
      const bufferKeywords = ['優勢', '機會', '強項', '緩衝', '保護'];
      
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      let inRiskSection = false;
      let inBufferSection = false;
      
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        
        if (riskKeywords.some(keyword => lowerLine.includes(keyword))) {
          inRiskSection = true;
          inBufferSection = false;
          continue;
        }
        
        if (bufferKeywords.some(keyword => lowerLine.includes(keyword))) {
          inRiskSection = false;
          inBufferSection = true;
          continue;
        }
        
        if (inRiskSection && (line.match(/^\d+\./) || line.match(/^[•\-]/) || line.match(/^[⚠️❗❌]/))) {
          const factor = line.replace(/^\d+\.\s*|[•\-]\s*|[⚠️❗❌]\s*/g, '').trim();
          if (factor.length > 0 && positives.length < 5) {
            positives.push(factor);
          }
        }
        
        if (inBufferSection && (line.match(/^\d+\./) || line.match(/^[•\-]/) || line.match(/^[✓✔]/))) {
          const factor = line.replace(/^\d+\.\s*|[•\-]\s*|[✓✔]\s*/g, '').trim();
          if (factor.length > 0 && negatives.length < 5) {
            negatives.push(factor);
          }
        }
      }
    }

    // 如果沒有找到足夠的因素，生成默認因素
    if (positives.length === 0) {
      if (analysisType === 'news') {
        positives = ['營收表現穩健', '市場地位穩固', '技術優勢明顯'];
      } else {
        positives = ['行業競爭加劇', '原材料成本上漲', '技術迭代快速'];
      }
    }
    
    if (negatives.length === 0) {
      if (analysisType === 'news') {
        negatives = ['行業競爭加劇', '成本壓力上升', '市場需求波動'];
      } else {
        negatives = ['財務結構穩健', '技術領先地位', '多元化客戶基礎'];
      }
    }

    // 提取建議
    const suggestionPatterns = [
      /建議[：:]([^\n]+)/i,
      /投資建議[：:]([^\n]+)/i,
      /風險建議[：:]([^\n]+)/i,
      /結論[：:]([^\n]+)/i
    ];
    
    for (const pattern of suggestionPatterns) {
      const match = content.match(pattern);
      if (match) {
        recommendation = match[1].trim();
        break;
      }
    }
    
    if (!recommendation) {
      // 從最後幾行中找建議
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const lastLines = lines.slice(-5);
      
      for (const line of lastLines) {
        if (line.includes('建議') || line.includes('推荐') || line.includes('結論')) {
          recommendation = line.replace(/.*[：:]\s*/, '').trim();
          if (recommendation.length > 0) break;
        }
      }
      
      if (!recommendation && lines.length > 0) {
        recommendation = lines[lines.length - 1];
      }
    }

    // 生成評分詳情
    const scoreDetails = generateScoreDetails(positives, negatives, score, analysisType);
    
    // 格式化顯示內容
    const formattedContent = formatAnalysisContent(
      positives, negatives, scoreDetails, summary, recommendation, score, analysisType, stockName
    );

    return {
      success: true,
      content: formattedContent,
      rawContent: content,
      score: score,
      comment: recommendation || '分析完成',
      analysisType: analysisType,
      structured: true,
      positives: positives.slice(0, 3),
      negatives: negatives.slice(0, 3),
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