// fetch-twse.js (Netlify Function)
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // 設置 CORS 標頭
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const type = event.queryStringParameters.type; 

    // 定義正確的資料來源 URL (修正: 新增 monthly 營收資料的 API)
    const sources = {
        // [季度資料] 綜合損益表 (包含 EPS)
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',  // 一般產業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh',  // 金控業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd',  // 證券期貨
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins'  // 保險業
        ],
        // [年度/分析資料] 營益分析彙總表 (包含 毛利率、純益率)
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L'      // 全體上市公司彙總
        ],
        // [月營收資料] (新增此項以支援營收增率抓取)
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L' 
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { 
            statusCode: 400, 
            headers,
            body: JSON.stringify({ error: 'Invalid type parameter' }) 
        };
    }

    try {
        console.log(`Fetching TWSE data for type: ${type}`);
        
        // 平行抓取所有 URL
        const requests = targetUrls.map(url => fetch(url).then(res => {
            if (!res.ok) {
                console.warn(`Request to ${url} failed with status: ${res.status}`);
                return []; 
            }
            return res.json().catch(() => {
                console.warn(`Failed to parse JSON from ${url}`);
                return []; 
            });
        }).catch(err => {
             console.error(`Fetch error for ${url}: ${err.message}`);
             return []; 
        }));
        
        const results = await Promise.all(requests);
        
        // 將所有來源的結果合併成單一陣列
        const combinedData = results.flat().filter(item => item && (item.Code || item.公司代號));

        console.log(`Successfully combined ${combinedData.length} records for type: ${type}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(combinedData),
        };

    } catch (error) {
        console.error('Final TWSE data processing error:', error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal Server Error during TWSE data processing.', details: error.message }),
        };
    }
};