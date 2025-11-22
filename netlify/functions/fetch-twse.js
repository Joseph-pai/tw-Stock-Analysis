const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const type = event.queryStringParameters.type; 

    // 定義「全產業」資料來源 URL
    const sources = {
        // [季度資料] 綜合損益表 (來源：證交所 Open Data)
        // 包含：一般業(ci)、金控(fh)、證券(bd)、保險(ins)
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh',
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd',
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins'
        ],
        // [年度/分析資料] 財務比率分析
        // 包含：一般業(A)、金控(B)、證券(C)、保險(D)
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L', // 經營績效-一般
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L'  // 營益分析彙總 (最常用)
        ],
        // [月營收資料]
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if'
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    try {
        // 平行抓取所有產業的資料表
        const requests = targetUrls.map(url => fetch(url).then(res => {
            if (!res.ok) return [];
            return res.json().catch(() => []);
        }).catch(() => []));
        
        const results = await Promise.all(requests);
        
        // 合併所有結果
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