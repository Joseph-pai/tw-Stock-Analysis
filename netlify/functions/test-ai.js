exports.handler = async function(event, context) {
  console.log('測試函數被調用');
  
  return {
    statusCode: 200,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify({ 
      message: '測試成功',
      timestamp: new Date().toISOString()
    })
  };
};