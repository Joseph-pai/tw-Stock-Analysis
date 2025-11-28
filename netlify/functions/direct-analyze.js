const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('=== 直接分析開始 ===');
  
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
    
    console.log(`直接分析: ${stockId} ${stockName}`);

    if (!stockId || !apiKey) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '缺少必要參數' })
      };
    }

    // 直接調用DeepSeek API，不經過中間處理
    const prompt = `請分析台灣股票 ${stockId} ${stockName} 的${analysisType === 'news' ? '市場消息面' : '風險面'}。
    
請提供：
1. 3個主要正面因素
2. 3個主要負面因素  
3. 綜合評分（-10到+10）
4. 簡要評語

用中文回答。`;

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
        max_tokens: 1000
      })
    });

    console.log('直接API響應狀態:', response.status);

    if (!response.ok) {
      throw new Error(`DeepSeek API錯誤: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // 簡單解析評分
    let score = 0;
    const scoreMatch = content.match(/([+-]?\d+)\s*分/);
    if (scoreMatch) score = parseInt(scoreMatch[1]) || 0;

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        content: content,
        score: score,
        comment: '分析完成',
        analysisType: analysisType
      })
    };

  } catch (error) {
    console.error('直接分析錯誤:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: error.message,
        suggestion: '請檢查API Key和網絡連接'
      })
    };
  }
};