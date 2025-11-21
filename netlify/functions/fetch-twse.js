const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // 取得前端請求的類型 (quarterly=財報, annual=財務比率)
    const type = event.queryStringParameters.type; 

    // 定義證交所的 Open Data API 網址
    const urls = {
        // 財務報告 (EPS 等)
        quarterly: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
        // 財務比率 (ROE, 毛利率 等)
        annual: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L'
    };

    const targetUrl = urls[type];

    if (!targetUrl) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid type parameter' }) };
    }

    try {
        console.log(`Fetching TWSE data from: ${targetUrl}`);
        const response = await fetch(targetUrl);
        
        if (!response.ok) {
            return { statusCode: response.status, body: `TWSE API Error: ${response.statusText}` };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data) // 直接回傳完整的證交所資料陣列
        };

    } catch (error) {
        console.error('TWSE Proxy Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};