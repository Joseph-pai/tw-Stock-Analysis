const fetch = require('node-fetch'); // Netlify Functions 預設支持 node-fetch

/**
 * Netlify Function 專門用於安全、穩定地從 Yahoo Finance 獲取財報數據
 * 這樣可以繞過瀏覽器端的 CORS 限制。
 */
exports.handler = async (event, context) => {
    // 獲取前端傳入的股票代碼 (e.g., id=2330)
    const stockId = event.queryStringParameters.id; 

    if (!stockId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing stock ID (id parameter)' }),
        };
    }

    const symbol = `${stockId}.TW`;
    // 請求 Yahoo Finance 的 quoteSummary API，包含 defaultKeyStatistics 和 financialData 兩個模組
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData`;

    try {
        // 在伺服器端發起請求，不受 CORS 限制
        const response = await fetch(yahooUrl);
        
        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `Yahoo API response error: ${response.statusText}` }),
            };
        }

        const data = await response.json();
        
        // 檢查數據結構是否正確
        if (data?.quoteSummary?.result?.[0]) {
            return {
                statusCode: 200,
                // 返回 JSON 數據給前端
                body: JSON.stringify(data.quoteSummary.result[0]),
            };
        } else {
             return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Yahoo Finance did not return valid data.' }),
            };
        }

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Internal server error: ${error.message}` }),
        };
    }
};