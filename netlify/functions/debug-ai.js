const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log('Debug函數被調用', {
    method: event.httpMethod,
    body: event.body ? JSON.parse(event.body) : 'No body',
    headers: event.headers
  });

  try {
    // 測試簡單的DeepSeek請求
    const testResponse = await fetch('https://api.deepseek.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer sk-test',
        'Content-Type': 'application/json'
      }
    });

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        message: 'Debug函數運行正常',
        deepseekStatus: testResponse.status,
        deepseekStatusText: testResponse.statusText,
        timestamp: new Date().toISOString(),
        nodeVersion: process.version
      })
    };

  } catch (error) {
    console.error('Debug函數錯誤:', error);
    
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'Debug失敗',
        message: error.message,
        stack: error.stack
      })
    };
  }
};