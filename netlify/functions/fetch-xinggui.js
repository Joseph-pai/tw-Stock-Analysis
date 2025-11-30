// /.netlify/functions/fetch-xinggui.js
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const { stockId, dataType = 'financials' } = event.queryStringParameters;
    
    // CORS 頭部
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        let result;
        
        switch(dataType) {
            case 'basic':
                result = await fetchXingGuiBasicInfo(stockId);
                break;
            case 'financials':
                result = await fetchXingGuiFinancials(stockId);
                break;
            case 'price':
                result = await fetchXingGuiPrice(stockId);
                break;
            default:
                throw new Error(`不支持的數據類型: ${dataType}`);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('興櫃數據獲取錯誤:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: error.message,
                source: 'xinggui'
            })
        };
    }
};

// 獲取興櫃公司基本資訊
async function fetchXingGuiBasicInfo(stockId) {
    const url = `https://www.tpex.org.tw/web/regular_emerging/raising/raising_result.php?l=zh-tw&o=json&stkno=${stockId}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`券商公會API失敗: ${response.status}`);
    
    const data = await response.json();
    
    return {
        stockId: stockId,
        name: data.aaData?.[0]?.[1] || '未知',
        industry: data.aaData?.[0]?.[2] || '未知',
        listingDate: data.aaData?.[0]?.[3] || '未知',
        source: 'tpex_xinggui'
    };
}

// 獲取興櫃公司財務數據
async function fetchXingGuiFinancials(stockId) {
    // 公開資訊觀測站 - 興櫃公司財務報表
    const url = 'https://mops.twse.com.tw/mops/web/ajax_t100sb15';
    
    const formData = new URLSearchParams();
    formData.append('encodeURIComponent', '1');
    formData.append('step', '1');
    formData.append('firstin', '1');
    formData.append('off', '1');
    formData.append('co_id', stockId);
    formData.append('TYPEK', 'all');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData
    });

    if (!response.ok) throw new Error(`公開觀測站失敗: ${response.status}`);
    
    const html = await response.text();
    return parseMOPSFinancials(html, stockId);
}

// 解析公開觀測站HTML
function parseMOPSFinancials(html, stockId) {
    // 這裡需要根據實際HTML結構解析
    // 以下是示例解析邏輯
    
    const financials = {
        stockId: stockId,
        eps: extractEPS(html),
        revenue: extractRevenue(html),
        profit: extractProfit(html),
        roe: extractROE(html),
        date: new Date().toISOString().split('T')[0],
        source: 'mops_xinggui'
    };

    return financials;
}

// 獲取興櫃公司股價
async function fetchXingGuiPrice(stockId) {
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&o=json&stkno=${stockId}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`興櫃股價API失敗: ${response.status}`);
    
    const data = await response.json();
    
    return {
        stockId: stockId,
        price: parseFloat(data.aaData?.[0]?.[2]) || null,
        change: data.aaData?.[0]?.[3] || null,
        volume: data.aaData?.[0]?.[1] || null,
        date: data.aaData?.[0]?.[0] || null,
        source: 'tpex_price'
    };
}