const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('=== DeepSeek 股票分析開始 ===');
  
  // CORS 處理
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
      body: JSON.stringify({ error: '只允許POST請求' })
    };
  }

  try {
    const { stockId, stockName, apiKey, analysisType } = JSON.parse(event.body || '{}');
    
    console.log(`分析請求: ${stockId} ${stockName}, 類型: ${analysisType}`);

    if (!stockId || !apiKey) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '缺少股票代碼或API Key' })
      };
    }

    // 直接使用 DeepSeek 進行網絡搜索和分析
    const analysisResult = await analyzeStockWithDeepSeek(stockId, stockName, apiKey, analysisType);

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(analysisResult)
    };

  } catch (error) {
    console.error('DeepSeek分析錯誤:', error);
    
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: `分析失敗: ${error.message}`,
        suggestion: '請檢查API Key是否有效且有足夠餘額'
      })
    };
  }
};

// 使用 DeepSeek 進行股票分析
async function analyzeStockWithDeepSeek(stockId, stockName, apiKey, analysisType) {
  const prompt = createStockAnalysisPrompt(stockId, stockName, analysisType);

  console.log('發送分析請求到DeepSeek API...');

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
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: await response.text() };
    }
    
    if (response.status === 401) {
      throw new Error('DeepSeek API Key 無效或未授權');
    } else if (response.status === 429) {
      throw new Error('API 請求頻率限制，請稍後重試');
    } else if (response.status === 500) {
      throw new Error('DeepSeek 服務器內部錯誤');
    } else {
      throw new Error(`DeepSeek API 錯誤 ${response.status}: ${JSON.stringify(errorData)}`);
    }
  }

  const data = await response.json();
  console.log('DeepSeek API 響應接收成功');
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('DeepSeek API 返回數據格式錯誤');
  }
  
  return parseDeepSeekResponse(data.choices[0].message.content, analysisType);
}

// 創建股票分析提示詞 - 讓AI從互聯網獲取最新資訊
function createStockAnalysisPrompt(stockId, stockName, analysisType) {
  const currentDate = new Date().toISOString().split('T')[0];
  
  if (analysisType === 'news') {
    return `你是一個專業的股票分析師。今天是 ${currentDate}，請分析台灣股票 ${stockId} ${stockName} 的最新市場消息面和新聞資訊面。

請基於最新的互聯網資訊（包括新聞、分析師報告、市場動態等）進行分析，並提供以下結構的報告：

📈 正面因素 (利多):
1. [具體的正面因素1 - 包含實際數據和來源說明]
2. [具體的正面因素2 - 包含實際數據和來源說明] 
3. [具體的正面因素3 - 包含實際數據和來源說明]

⚠️ 負面/謹慎因素 (風險):
1. [具體的負面因素1 - 包含風險評估和影響分析]
2. [具體的負面因素2 - 包含風險評估和影響分析]
3. [具體的負面因素3 - 包含風險評估和影響分析]

🔍 關鍵事件與影響:
- [重要財報發佈、產品新聞、市場事件等]
- [對股價的潛在影響分析]

🔢 綜合評分計算:
請基於以下因素給出詳細評分：
- 營收成長性與財務表現
- 市場地位與競爭優勢  
- 行業趨勢與政策影響
- 近期新聞與分析師評價
- 技術面與市場情緒

每個因素最高+2分，最低-2分，請詳細說明評分理由。

🎯 最終評分: [必須是-10到+10之間的整數]
💬 評語: [50字以内的總結，包含投資建議]

請確保分析基於最新可得的市場資訊，並提供客觀專業的評估。`;
  } else {
    return `你是一個專業的風險分析師。今天是 ${currentDate}，請分析台灣股票 ${stockId} ${stockName} 的風險面因素。

請基於最新的市場資訊進行全面風險評估，並提供以下結構的報告：

📉 負面風險因素 (扣分):
1. [財務風險 - 包含具體數據和分析]
2. [市場風險 - 包含行業和宏觀因素]  
3. [營運風險 - 包含公司特定風險]
4. [地緣政治風險 - 如適用]

🛡️ 風險緩衝因素 (加分/抵抗力):
1. [財務穩健性 - 現金流、負債等]
2. [市場地位與護城河]
3. [管理團隊與公司治理]
4. [多元化與創新能力]

🔍 風險事件監控:
- [需要關注的近期風險事件]
- [潛在的黑天鵝事件]

🔢 綜合評分計算:
請基於以下維度給出詳細評分：
- 財務風險程度 (0到-3分)
- 市場風險暴露 (0到-2分)
- 營運風險水平 (0到-2分)  
- 風險緩衝能力 (0到+3分)
- 風險管理品質 (0到+2分)

請詳細說明每個維度的評分理由。

🎯 最終評分: [必須是-10到+10之間的整數]
💬 評語: [50字以内的風險總結和建議]

請提供基於最新資訊的客觀風險評估。`;
  }
}

// 解析 DeepSeek 回應
function parseDeepSeekResponse(content, analysisType) {
  try {
    console.log('解析DeepSeek回應，內容長度:', content.length);
    
    // 提取評分 - 多種匹配模式
    let score = 0;
    const scorePatterns = [
      /最終評分:\s*([+-]?\d+)/,
      /最終評分\s*[：:]\s*([+-]?\d+)/,
      /評分:\s*([+-]?\d+)/,
      /總評分:\s*([+-]?\d+)/,
      /得分:\s*([+-]?\d+)/,
      /([+-]?\d+)\s*分/,
      /總分:\s*([+-]?\d+)/
    ];
    
    for (const pattern of scorePatterns) {
      const match = content.match(pattern);
      if (match) {
        const potentialScore = parseInt(match[1]);
        if (!isNaN(potentialScore) && potentialScore >= -10 && potentialScore <= 10) {
          score = potentialScore;
          console.log('找到評分:', score);
          break;
        }
      }
    }

    // 提取評語
    let comment = '分析完成';
    const commentPatterns = [
      /評語:\s*(.+?)(?=\n|$)/,
      /評語\s*[：:]\s*(.+?)(?=\n|$)/,
      /總結:\s*(.+?)(?=\n|$)/,
      /建議:\s*(.+?)(?=\n|$)/,
      /分析[：:]\s*(.+?)(?=\n|$)/
    ];
    
    for (const pattern of commentPatterns) {
      const match = content.match(pattern);
      if (match && match[1].trim().length > 0) {
        comment = match[1].trim();
        if (comment.length > 100) {
          comment = comment.substring(0, 100) + '...';
        }
        console.log('找到評語:', comment);
        break;
      }
    }

    return {
      success: true,
      content: content,
      score: score,
      comment: comment,
      analysisType: analysisType,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('解析DeepSeek回應錯誤:', error);
    return {
      success: true,
      content: content,
      score: 0,
      comment: '分析內容已生成，請手動查看詳細報告',
      analysisType: analysisType,
      timestamp: new Date().toISOString()
    };
  }
}