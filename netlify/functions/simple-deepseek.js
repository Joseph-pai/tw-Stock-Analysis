const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('=== 簡單DeepSeek測試開始 ===');
  
  // CORS處理
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
    const { apiKey } = JSON.parse(event.body || '{}');
    
    if (!apiKey) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '缺少API Key' })
      };
    }

    console.log('API Key前10位:', apiKey.substring(0, 10) + '...');

    // 最簡單的測試請求
    const testResponse = await fetch('https://api.deepseek.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10秒超時
    });

    console.log('DeepSeek API響應狀態:', testResponse.status);
    
    const responseText = await testResponse.text();
    console.log('響應長度:', responseText.length);
    console.log('響應前200字符:', responseText.substring(0, 200));

    if (!testResponse.ok) {
      return {
        statusCode: testResponse.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: `DeepSeek API錯誤: ${testResponse.status}`,
          response: responseText.substring(0, 500)
        })
      };
    }

    // 嘗試解析JSON
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'DeepSeek返回了非JSON響應',
          response: responseText.substring(0, 500)
        })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        message: 'DeepSeek API連線正常',
        models: responseData.data ? responseData.data.length : '未知',
        status: testResponse.status
      })
    };

  } catch (error) {
    console.error('簡單測試錯誤:', error);
    
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: '測試失敗: ' + error.message,
        type: error.name,
        code: error.code
      })
    };
  }
};