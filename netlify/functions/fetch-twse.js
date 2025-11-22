const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const type = event.queryStringParameters.type; 

    // 定義「全產業」資料來源 URL (解決 N/A 問題的關鍵)
    const sources = {
        // [季度資料] 綜合損益表
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', // 一般
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh', // 金控
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd', // 證券
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins' // 保險
        ],
        // [年度/分析資料] 財務比率
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L', // 營益分析
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'  // 經營績效
        ],
        // [月營收資料] 解決營收增率問題
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if'
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    try {
        // 平行抓取所有產業資料
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