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

    // 使用結構化提示詞
    const prompt = createStructuredPrompt(stockId, stockName, analysisType);

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
    const parsedResult = parseStructuredResponse(content, analysisType);

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

// 創建結構化提示詞
function createStructuredPrompt(stockId, stockName, analysisType) {
  const currentDate = new Date().toLocaleDateString('zh-TW');
  
  if (analysisType === 'news') {
    return `作為專業股票分析師，請分析台灣股票 ${stockId} ${stockName} 在 ${currentDate} 的最新市場消息面。

請嚴格按照以下格式提供分析：

【正面因素】
1. [具體利多因素1 - 請提供實際數據或事件]
2. [具體利多因素2 - 請提供實際數據或事件] 
3. [具體利多因素3 - 請提供實際數據或事件]

【負面因素】
1. [具體利空因素1 - 請提供風險分析]
2. [具體利空因素2 - 請提供風險分析]
3. [具體利空因素3 - 請提供風險分析]

【重點整理】
• 關鍵事件：[列出最重要的市場事件]
• 分析師觀點：[總結分析師看法]
• 市場情緒：[描述當前市場情緒]

【評分計算】
根據以下維度評分（每個維度-2到+2分）：
• 營收成長性：[]分
• 盈利能力：[]分
• 市場地位：[]分  
• 行業前景：[]分
• 新聞影響：[]分
• 技術面：[]分
總分計算：[]分

【最終評分】[必須是-10到+10的整數]

【投資建議】[50字內的具體建議]

請基於最新市場資訊提供真實、客觀的分析。`;
  } else {
    return `作為專業風險分析師，請分析台灣股票 ${stockId} ${stockName} 在 ${currentDate} 的風險面因素。

請嚴格按照以下格式提供分析：

【高風險因素】
1. [具體高風險1 - 請說明風險程度和影響]
2. [具體高風險2 - 請說明風險程度和影響]

【中風險因素】  
1. [具體中風險1 - 請說明潛在影響]
2. [具體中風險2 - 請說明潛在影響]

【低風險因素】
1. [具體低風險1 - 請說明監控要點]
2. [具體低風險2 - 請說明監控要點]

【風險緩衝】
1. [公司優勢1 - 如何抵禦風險]
2. [公司優勢2 - 如何抵禦風險]

【重點整理】
• 最大風險：[指出最主要的風險]
• 風險趨勢：[風險在增加/減少/穩定]
• 監控指標：[需要關注的關鍵指標]

【評分計算】
根據以下維度評分（負分表示風險，正分表示抵抗力）：
• 財務風險：[]分
• 市場風險：[]分
• 營運風險：[]分
• 行業風險：[]分
• 管理風險：[]分
• 風險緩衝：[]分
總分計算：[]分

【最終評分】[必須是-10到+10的整數]

【風險建議】[50字內的具體建議]

請提供基於實際情況的客觀風險評估。`;
  }
}

// 解析結構化回應
function parseStructuredResponse(content, analysisType) {
  try {
    console.log('開始解析結構化回應...');
    
    let score = 0;
    let positives = [];
    let negatives = [];
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
      positives = positivesText.split('\n').filter(line => 
        line.trim().match(/^\d+\./) && line.trim().length > 5
      ).map(line => line.replace(/^\d+\.\s*/, '').trim());
      console.log('提取正面因素:', positives.length);
    }

    // 提取負面因素
    const negativesMatch = content.match(/【負面因素】([\s\S]*?)【重點整理】/);
    if (negativesMatch) {
      const negativesText = negativesMatch[1];
      negatives = negativesText.split('\n').filter(line => 
        line.trim().match(/^\d+\./) && line.trim().length > 5
      ).map(line => line.replace(/^\d+\.\s*/, '').trim());
      console.log('提取負面因素:', negatives.length);
    }

    // 提取重點整理
    const summaryMatch = content.match(/【重點整理】([\s\S]*?)【評分計算】/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    // 提取建議
    const recommendationMatch = content.match(/【(投資建議|風險建議)】([\s\S]*?)(?=【|$)/);
    if (recommendationMatch) {
      recommendation = recommendationMatch[2].trim();
    }

    // 如果沒有找到結構化內容，使用原始內容
    if (positives.length === 0 && negatives.length === 0) {
      console.log('未找到結構化內容，使用原始內容');
      positives = ['AI返回了分析內容，但格式不符合預期'];
      negatives = ['請查看完整分析報告'];
      summary = '請查看上方的完整分析內容';
      recommendation = '基於AI分析給出的建議';
    }

    // 格式化顯示內容
    const formattedContent = formatAnalysisContent(
      positives, 
      negatives, 
      summary, 
      recommendation, 
      score,
      analysisType
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
      negatives: negatives
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

// 格式化分析內容
function formatAnalysisContent(positives, negatives, summary, recommendation, score, analysisType) {
  let formatted = '';
  
  if (analysisType === 'news') {
    formatted += `📊 ${score > 0 ? '🟢' : score < 0 ? '🔴' : '🟡'} 消息面分析評分: ${score > 0 ? '+' : ''}${score}/10\n\n`;
    
    formatted += `🌟 正面因素 (利多):\n`;
    positives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
    formatted += `\n⚠️ 負面因素 (風險):\n`;
    negatives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
  } else {
    formatted += `📊 ${score > 0 ? '🟢' : score < 0 ? '🔴' : '🟡'} 風險面分析評分: ${score > 0 ? '+' : ''}${score}/10\n\n`;
    
    formatted += `🔴 高風險因素:\n`;
    positives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
    
    formatted += `\n🛡️ 風險緩衝因素:\n`;
    negatives.forEach((item, index) => {
      formatted += `${index + 1}. ${item}\n`;
    });
  }
  
  if (summary) {
    formatted += `\n📋 重點整理:\n${summary}\n`;
  }
  
  if (recommendation) {
    formatted += `\n💡 建議:\n${recommendation}\n`;
  }
  
  formatted += `\n---\n*分析時間: ${new Date().toLocaleString('zh-TW')}*`;
  
  return formatted;
}