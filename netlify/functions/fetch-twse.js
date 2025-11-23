const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const type = event.queryStringParameters.type; 

    // 定義資料來源 URL
    const sources = {
        // [股票清單資料] 用於取代 FinMind TaiwanStockInfo
        stocks: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap03_L' // 上市公司基本資料
        ],
        // [季度資料] 綜合損益表
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',  // 一般產業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh',  // 金控業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd',  // 證券期貨
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins', // 保險業
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'      // *** 綜合損益表彙總表 (含累計營收) ***
        ],
        // [年度/分析資料] 營益分析彙總表
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L',
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'
        ],
        // [月營收資料]
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if'
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type parameter' }) };
    }

    try {
        console.log(`Fetching TWSE data for type: ${type}`);
        
        // 平行抓取所有 URL
        const requests = targetUrls.map(url => fetch(url).then(res => {
            if (!res.ok) {
                console.error(`Error fetching ${url}: ${res.status} ${res.statusText}`);
                return []; // 返回空陣列，避免中斷整體流程
            }
            return res.json().catch(err => {
                console.error(`JSON parse error from ${url}: ${err.message}`);
                return []; // 返回空陣列
            });
        }).catch(err => {
            console.error(`Network error from ${url}: ${err.message}`);
            return []; // 返回空陣列
        }));
        
        const allDataArrays = await Promise.all(requests);
        
        // 合併所有來源的數據
        const combinedData = allDataArrays.flat().filter(item => item && (item.Code || item.公司代號));
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(combinedData)
        };

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error during TWSE fetch.' })
        };
    }
};