const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const type = event.queryStringParameters.type; 
    
    // 定義資料來源 URL
    const sources = {
        // [季度資料] 綜合損益表 (含 EPS)
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',  // 一般產業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh',  // 金控業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd',  // 證券期貨
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins'  // 保險業
        ],
        // [年度/分析資料] 營益分析彙總表 (含 毛利率)
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L'
        ],
        // [月營收資料] *** 新增此區塊以獲取月營收增率 ***
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if'      // 採IFRSs後之月營業收入資訊
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid type parameter' }) };
    }

    try {
        console.log(`Fetching TWSE data for type: ${type}`);
        
        const requests = targetUrls.map(url => fetch(url).then(res => {
            if (!res.ok) throw new Error(`Failed to fetch ${url}`);
            return res.json();
        }));

        const results = await Promise.all(requests);
        const mergedData = results.flat();

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mergedData)
        };

    } catch (error) {
        console.error('TWSE Proxy Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};