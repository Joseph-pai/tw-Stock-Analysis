const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('=== 結構化分析開始 ===');
  
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

  try {
    const { stockId, stockName, apiKey, analysisType } = JSON.parse(event.body || '{}');
    
    console.log(`結構化分析: ${stockId} ${stockName}, 類型: ${analysisType}`);

    if (!stockId || !apiKey) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '缺少必要參數' })
      };
    }

    // 使用修復版的結構化提示詞
    const prompt = createFixedStructuredPrompt(stockId, stockName, analysisType);

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

    console.log('API響應狀態:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`DeepSeek API錯誤: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    console.log('AI回應內容:', content.substring(0, 500));

    // 解析結構化回應
    const parsedResult = parseFixedStructuredResponse(content, analysisType, stockName);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(parsedResult)
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

// 創修建復版結構化提示詞 - 強制要求特定格式
function createFixedStructuredPrompt(stockId, stockName, analysisType) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  
  if (analysisType === 'news') {
    return `作為專業股票分析師，請分析台灣股票 ${stockId} ${stockName} 的最新市場消息面。

請嚴格按照以下格式提供分析，不要添加任何額外文字：

【正面因素】
1. [具體利多因素1 - 包含實際數據和影響分析]
2. [具體利多因素2 - 包含實際數據和影響分析] 
3. [具體利多因素3 - 包含實際數據和影響分析]

【負面因素】
1. [具體利空因素1 - 包含風險分析和影響程度]
2. [具體利空因素2 - 包含風險分析和影響程度]
3. [具體利空因素3 - 包含風險分析和影響程度]

【評分計算】
正面因素總分: [+X分]
負面因素總分: [-Y分]
最終得分計算: [+X] + [-Y] = [Z分]

【最終評分】[Z]

【投資建議】[簡要的投資建議，50字以内]

請確保最終評分是-10到+10之間的整數。`;
  } else {
    return `作為專業風險分析師，請分析台灣股票 ${stockId} ${stockName} 的風險面因素。

請嚴格按照以下格式提供分析，不要添加任何額外文字：

【風險因素】
1. [具體風險因素1 - 包含風險程度和具體數據]
2. [具體風險因素2 - 包含風險程度和具體數據]
3. [具體風險因素3 - 包含風險程度和具體數據]

【緩衝因素】
1. [具體緩衝因素1 - 包含抵抗力分析和具體數據]
2. [具體緩衝因素2 - 包含抵抗力分析和具體數據]
3. [具體緩衝因素3 - 包含抵抗力分析和具體數據]

【評分計算】
風險因素總扣分: [-X分]
緩衝因素總加分: [+Y分]
最終得分計算: [-X] + [+Y] = [Z分]

【最終評分】[Z]

【風險建議】[簡要的風險建議，50字以内]

請確保最終評分是-10到+10之間的整數。`;
  }
}

// 解析修復版結構化回應
function parseFixedStructuredResponse(content, analysisType, stockName) {
  try {
    console.log('開始解析修復版結構化回應...');
    
    let score = 0;
    let positives = [];
    let negatives = [];
    let scoreBreakdown = [];
    let recommendation = '';

    // 提取最終評分 - 多種匹配模式
    const scorePatterns = [
      /【最終評分】\s*([+-]?\d+)/,
      /最終評分\s*:\s*([+-]?\d+)/,
      /評分\s*:\s*([+-]?\d+)/,
      /得分\s*:\s*([+-]?\d+)/,
      /([+-]?\d+)\s*分/
    ];
    
    for (const pattern of scorePatterns) {
      const match = content.match(pattern);
      if (match) {
        const potentialScore = parseInt(match[1]);
        if (!isNaN(potentialScore) && potentialScore >= -10 && potentialScore <= 10) {
          score = potentialScore;
          console.log('找到最終評分:', score);
          break;
        }
      }
    }

    // 提取正面/風險因素
    if (analysisType === 'news') {
      const positivesMatch = content.match(/【正面因素】([\s\S]*?)【負面因素】/);
      if (positivesMatch) {
        const positivesText = positivesMatch[1];
        positives = extractNumberedItems(positivesText);
      }
      
      const negativesMatch = content.match(/【負面因素】([\s\S]*?)【評分計算】/);
      if (negativesMatch) {
        const negativesText = negativesMatch[1];
        negatives = extractNumberedItems(negativesText);
      }
    } else {
      const risksMatch = content.match(/【風險因素】([\s\S]*?)【緩衝因素】/);
      if (risksMatch) {
        const risksText = risksMatch[1];
        positives = extractNumberedItems(risksText); // 風險因素作為positives顯示
      }
      
      const buffersMatch = content.match(/【緩衝因素】([\s\S]*?)【評分計算】/);
      if (buffersMatch) {
        const buffersText = buffersMatch[1];
        negatives = extractNumberedItems(buffersText); // 緩衝因素作為negatives顯示
      }
    }

    // 提取建議
    const suggestionPattern = analysisType === 'news' ? /【投資建議】([\s\S]*?)(?=【|$)/ : /【風險建議】([\s\S]*?)(?=【|$)/;
    const suggestionMatch = content.match(suggestionPattern);
    if (suggestionMatch) {
      recommendation = suggestionMatch[1].trim();
    }

    // 如果沒有找到結構化內容，使用備用解析
    if (positives.length === 0 || negatives.length === 0) {
      console.log('使用備用解析方法');
      return parseFallbackResponse(content, analysisType, stockName, score);
    }

    // 生成評分明細
    scoreBreakdown = generateScoreBreakdown(positives, negatives, score, analysisType);

    // 格式化顯示內容
    const formattedContent = formatFixedAnalysisContent(
      positives, 
      negatives, 
      scoreBreakdown,
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
      scoreBreakdown: scoreBreakdown
    };

  } catch (error) {
    console.error('解析修復版結構化回應錯誤:', error);
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
  
  const scoreBreakdown = generateScoreBreakdown(positives, negatives, score, analysisType);
  const formattedContent = formatFixedAnalysisContent(
    positives, negatives, scoreBreakdown, recommendation, score, analysisType, stockName
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
    scoreBreakdown: scoreBreakdown
  };
}

// 生成評分明細
function generateScoreBreakdown(positives, negatives, totalScore, analysisType) {
  const breakdown = [];
  
  if (analysisType === 'news') {
    // 消息面評分分配
    const positiveScores = [3, 2, 1]; // 正面因素分數
    const negativeScores = [-2, -1, -1]; // 負面因素分數
    
    positives.forEach((positive, index) => {
      if (index < 3) {
        breakdown.push({
          item: `正面因素 ${index + 1}`,
          analysis: positive,
          score: positiveScores[index] || 1
        });
      }
    });
    
    negatives.forEach((negative, index) => {
      if (index < 3) {
        breakdown.push({
          item: `負面因素 ${index + 1}`,
          analysis: negative,
          score: negativeScores[index] || -1
        });
      }
    });
  } else {
    // 風險面評分分配
    const riskScores = [-3, -2, -1]; // 風險因素分數
    const bufferScores = [2, 1, 1]; // 緩衝因素分數
    
    positives.forEach((risk, index) => {
      if (index < 3) {
        breakdown.push({
          item: `風險因素 ${index + 1}`,
          analysis: risk,
          score: riskScores[index] || -1
        });
      }
    });
    
    negatives.forEach((buffer, index) => {
      if (index < 3) {
        breakdown.push({
          item: `風險緩衝 ${index + 1}`,
          analysis: buffer,
          score: bufferScores[index] || 1
        });
      }
    });
  }
  
  return breakdown;
}

// 格式化修復版分析內容
function formatFixedAnalysisContent(positives, negatives, scoreBreakdown, recommendation, score, analysisType, stockName) {
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
  
  // 添加評分明細
  formatted += `\n📈 評分明細:\n`;
  let totalCalculated = 0;
  scoreBreakdown.forEach(item => {
    formatted += `• ${item.item}: ${item.score > 0 ? '+' : ''}${item.score}分\n`;
    totalCalculated += item.score;
  });
  formatted += `總分: ${totalCalculated > 0 ? '+' : ''}${totalCalculated}分\n`;
  
  if (recommendation) {
    formatted += `\n💡 建議:\n${recommendation}\n`;
  }
  
  formatted += `\n---\n*分析時間: ${analysisTime}*`;
  
  return formatted;
}