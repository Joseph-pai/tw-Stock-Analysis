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

  // 只允許 POST 請求
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('請求體:', event.body);
    const { stockId, stockName, platform, apiKey, analysisType } = JSON.parse(event.body || '{}');
    
    console.log(`解析參數: ${stockId}, ${platform}, ${analysisType}`);

    // 返回模擬數據進行測試
    const mockData = {
      success: true,
      content: `這是${analysisType === 'news' ? '消息面' : '風險面'}分析的模擬結果\n\n股票: ${stockId} ${stockName}\n平台: ${platform}\n\n正面因素:\n1. 測試正面因素1\n2. 測試正面因素2\n\n負面因素:\n1. 測試負面因素1\n\n最終評分: +5\n評語: 這是模擬分析結果`,
      score: 5,
      comment: '模擬分析完成',
      analysisType: analysisType
    };

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(mockData)
    };

  } catch (error) {
    console.error('函數錯誤:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: `內部服務器錯誤: ${error.message}`,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};