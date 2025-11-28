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

    let analysisResult;
    
    // 先測試 Claude
    if (platform === 'claude') {
      analysisResult = await analyzeWithClaude(stockId, stockName, apiKey, analysisType);
    } else {
      // 其他平台暫時返回模擬數據
      analysisResult = getMockAnalysis(stockId, stockName, platform, analysisType);
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
    console.error('函數錯誤:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: `分析失敗: ${error.message}`,
        details: process.env.NODE_ENV === 'development' ? error.stack : '請查看服務器日誌'
      })
    };
  }
};

// Claude 分析函數
async function analyzeWithClaude(stockId, stockName, apiKey, analysisType) {
  const prompt = analysisType === 'news' 
    ? createNewsAnalysisPrompt(stockId, stockName)
    : createRiskAnalysisPrompt(stockId, stockName);

  console.log('發送請求到Claude API...');

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

  console.log('Claude API 響應狀態:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API 錯誤詳情:', errorText);
    throw new Error(`Claude API 錯誤: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('Claude API 響應接收成功');
  
  return parseAIResponse(data.content[0].text, analysisType);
}

// 創建消息面分析提示詞
function createNewsAnalysisPrompt(stockId, stockName) {
  return `請分析台灣股票 ${stockId} ${stockName} 的最新市場消息面和新聞資訊面。

請按照以下結構提供分析結果：

正面因素 (利多):
1. [具體的正面因素1，包含詳細說明和分析]
2. [具體的正面因素2，包含詳細說明和分析]
3. [具體的正面因素3，包含詳細說明和分析]

負面/謹慎因素 (風險):
1. [具體的負面因素1，包含詳細說明和分析]
2. [具體的負面因素2，包含詳細說明和分析]
3. [具體的負面因素3，包含詳細說明和分析]

綜合評分計算:
[詳細說明每個因素的評分權重和計算過程]

最終評分: [數字，範圍-10到+10]
評語: [簡要的總結評語]

請基於最新的市場新聞、分析師報告和行業動態進行分析。`;
}

// 創建風險面分析提示詞
function createRiskAnalysisPrompt(stockId, stockName) {
  return `請分析台灣股票 ${stockId} ${stockName} 的風險面因素。

請按照以下結構提供分析結果：

負面風險因素 (扣分):
1. [具體的風險因素1，包含風險強度和詳細分析]
2. [具體的風險因素2，包含風險強度和詳細分析]
3. [具體的風險因素3，包含風險強度和詳細分析]

風險緩衝因素 (加分/抵抗力):
1. [具體的緩衝因素1，包含抵抗力和詳細分析]
2. [具體的緩衝因素2，包含抵抗力和詳細分析]
3. [具體的緩衝因素3，包含抵抗力和詳細分析]

綜合評分計算:
[詳細說明每個風險因素的評分權重和計算過程]

最終評分: [數字，範圍-10到+10]
評語: [簡要的風險總結評語]

請從財務風險、市場風險、行業風險、地緣政治風險等多個維度進行全面分析。`;
}

// 解析AI回應
function parseAIResponse(content, analysisType) {
  try {
    console.log('解析AI回應，內容長度:', content.length);
    console.log('回應開頭:', content.substring(0, 200));

    // 提取最終評分
    const scoreMatch = content.match(/最終評分:\s*([+-]?\d+)/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;

    // 提取評語
    const commentMatch = content.match(/評語:\s*(.+?)(?=\n|$)/);
    const comment = commentMatch ? commentMatch[1].trim() : '分析完成';

    return {
      success: true,
      content: content,
      score: Math.max(-10, Math.min(10, score)),
      comment: comment,
      analysisType: analysisType
    };
  } catch (error) {
    console.error('解析AI回應錯誤:', error);
    return {
      success: true,
      content: content,
      score: 0,
      comment: '自動解析失敗，請手動查看分析內容',
      analysisType: analysisType
    };
  }
}

// 模擬數據（用於其他平台）
function getMockAnalysis(stockId, stockName, platform, analysisType) {
  const mockData = {
    success: true,
    content: `這是${analysisType === 'news' ? '消息面' : '風險面'}分析的模擬結果\n\n股票: ${stockId} ${stockName}\n平台: ${platform}\n\n正面因素:\n1. 測試正面因素1\n2. 測試正面因素2\n\n負面因素:\n1. 測試負面因素1\n\n最終評分: +5\n評語: 這是模擬分析結果`,
    score: 5,
    comment: '模擬分析完成',
    analysisType: analysisType
  };
  
  return mockData;
}