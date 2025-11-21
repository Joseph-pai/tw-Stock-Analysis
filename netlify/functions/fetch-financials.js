const fetch = require('node-fetch');

/**
 * Netlify Function 專門用於安全、穩定地從 Yahoo Finance 獲取財報數據
 * 包含 User-Agent 標頭以繞過 Yahoo 的反爬蟲機制 (401/403 錯誤)
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
    // 請求 Yahoo Finance 的 quoteSummary API
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData`;

    try {
        // 發起請求，並加入 Header 模擬真實瀏覽器
        const response = await fetch(yahooUrl, {
            headers: {
                // 模擬 Chrome 瀏覽器的 User-Agent，避免被 Yahoo 視為機器人而阻擋
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/'
            }
        });
        
        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `Yahoo API response error: ${response.status} ${response.statusText}` }),
            };
        }

        const data = await response.json();
        
        // 檢查數據結構是否正確
        if (data?.quoteSummary?.result?.[0]) {
            return {
                statusCode: 200,
                // 設置 CORS 標頭，允許您的前端存取
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
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