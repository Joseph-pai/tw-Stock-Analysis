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
        // [季度資料] 綜合損益表
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', // 一般
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh', // 金控
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd', // 證券
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins' // 保險
        ],
        // [年度/分析資料] 財務比率 & 經營績效 (解決 ROE/增率 N/A 關鍵)
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L', // 營益分析 (最常用)
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'  // 經營績效 (含 ROE)
        ],
        // [月營收資料]
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if'
        ],
        // [股票清單備援]
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