const fetch = require('node-fetch');

/**
 * Netlify Function 專用於代理 TWSE 財報數據，以解決瀏覽器 CORS 限制。
 */
exports.handler = async (event, context) => {
    // 獲取前端傳入的類型參數 ('quarterly' or 'annual')
    const type = event.queryStringParameters.type; 

    if (!type || (type !== 'quarterly' && type !== 'annual')) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing or invalid type parameter (must be quarterly or annual).' }),
        };
    }

    // TWSE Open Data URLs (財報 API)
    const twseEndpoints = {
        quarterly: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
        annual: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L'
    };
    
    const twseUrl = twseEndpoints[type];

    try {
        // 在伺服器端發起請求，避免 CORS 限制
        const response = await fetch(twseUrl);
        
        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `TWSE API response error: ${response.statusText}` }),
            };
        }

        const data = await response.json();
        
        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error('TWSE Function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Internal server error: ${error.message}` }),
        };
    }
};