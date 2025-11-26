const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const type = event.queryStringParameters.type; 

    const sources = {
        // [季度資料] 綜合損益表 + t187ap05_L (累計營收來源)
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins',
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L' // *** 關鍵數據源 ***
        ],
        // [年度/分析資料]
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L',
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'
        ],
        // [月營收資料]
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if'
        ],
        // [股票清單]
        stocks: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    try {
        const requests = targetUrls.map(url => fetch(url).then(res => {
            if (!res.ok) return [];
            return res.json().catch(() => []);
        }).catch(() => []));
        
        const results = await Promise.all(requests);
        const combinedData = results.flat().filter(item => item && (item.Code || item.公司代號));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(combinedData),
        };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};