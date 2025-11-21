const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const type = event.queryStringParameters.type; 
    
    // 定義正確的資料來源 URL
    const sources = {
        // [季度資料] 綜合損益表 (包含 EPS)
        // 為了覆蓋所有產業，我們定義多個來源
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',  // 一般產業 (台積電、友達等)
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh',  // 金控業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd',  // 證券期貨
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins'  // 保險業
        ],
        // [年度/分析資料] 營益分析彙總表 (包含 毛利率、純益率)
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L'      // 全體上市公司彙總
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid type parameter' }) };
    }

    try {
        console.log(`Fetching TWSE data for type: ${type}`);
        
        // 平行抓取所有 URL (例如同時抓一般業+金控業)
        const requests = targetUrls.map(url => fetch(url).then(res => {
            if (!res.ok) throw new Error(`Failed to fetch ${url}`);
            return res.json();
        }));

        const results = await Promise.all(requests);
        
        // 合併所有結果到一個大陣列中
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