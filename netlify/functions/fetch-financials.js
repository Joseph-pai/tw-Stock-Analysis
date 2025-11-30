const fetch = require('node-fetch');

/**
 * 智能財報數據查詢協調器 - 簡化版本
 */
exports.handler = async (event, context) => {
    const stockId = event.queryStringParameters.id;
    
    if (!stockId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing stock ID' }),
        };
    }

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        console.log(`開始查詢股票 ${stockId} 的財務數據`);

        // 簡化邏輯：直接嘗試各數據源
        let result;
        let source;

        // 1. 先嘗試 FinMind
        try {
            result = await fetchFinMindFinancials(stockId);
            source = 'finmind';
        } catch (error) {
            console.log('FinMind failed:', error.message);
            
            // 2. 嘗試 Yahoo Finance
            try {
                result = await fetchYahooFinancials(stockId);
                source = 'yahoo';
            } catch (error) {
                console.log('Yahoo failed:', error.message);
                
                // 3. 嘗試興櫃數據
                try {
                    result = await fetchXingGuiFinancials(stockId);
                    source = 'xinggui';
                } catch (error) {
                    console.log('XingGui failed:', error.message);
                    throw new Error('所有數據源都失敗');
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ...result,
                source: source,
                stockId: stockId
            })
        };

    } catch (error) {
        console.error('財務數據查詢錯誤:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: `財務數據查詢失敗: ${error.message}`,
                stockId: stockId
            })
        };
    }
};

// FinMind 財務數據查詢 - 簡化版本
async function fetchFinMindFinancials(stockId) {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=${stockId}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`FinMind API錯誤: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
        throw new Error('FinMind無數據');
    }

    // 獲取最新一季數據
    const latest = data.data[data.data.length - 1];
    return {
        eps: parseFloat(latest.eps) || null,
        revenue: parseFloat(latest.revenue) || null,
        gross_margin: parseFloat(latest.gross_margin) || null,
        operating_margin: parseFloat(latest.operating_margin) || null,
        net_income: parseFloat(latest.net_income) || null,
        date: latest.date || null
    };
}

// Yahoo Finance 財務數據查詢 - 簡化版本
async function fetchYahooFinancials(stockId) {
    const symbol = `${stockId}.TW`;
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics`;

    const response = await fetch(yahooUrl);
    
    if (!response.ok) {
        throw new Error(`Yahoo API錯誤: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data?.quoteSummary?.result?.[0]) {
        throw new Error('Yahoo Finance無數據');
    }

    const result = data.quoteSummary.result[0];
    const financialData = result.financialData || {};
    const keyStatistics = result.defaultKeyStatistics || {};

    return {
        eps: financialData.epsTrailingTwelveMonths || financialData.epsCurrentYear,
        revenue: financialData.totalRevenue ? financialData.totalRevenue.raw : null,
        gross_margin: financialData.grossMargins ? financialData.grossMargins.raw : null,
        operating_margin: financialData.operatingMargins ? financialData.operatingMargins.raw : null,
        net_income: financialData.netIncomeToCommon ? financialData.netIncomeToCommon.raw : null,
        currentPrice: financialData.currentPrice ? financialData.currentPrice.raw : null,
        pe_ratio: financialData.trailingPE || null,
        date: new Date().toISOString().split('T')[0]
    };
}

// 興櫃財務數據查詢 - 簡化版本
async function fetchXingGuiFinancials(stockId) {
    // 嘗試獲取興櫃基本資訊
    const basicUrl = `https://www.tpex.org.tw/web/regular_emerging/raising/raising_result.php?l=zh-tw&o=json&stkno=${stockId}`;
    
    const response = await fetch(basicUrl);
    if (!response.ok) {
        throw new Error(`興櫃API錯誤: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.aaData || data.aaData.length === 0) {
        throw new Error('興櫃無數據');
    }

    const basicInfo = data.aaData[0];
    return {
        name: basicInfo[1] || '未知',
        industry: basicInfo[2] || '未知',
        listingDate: basicInfo[3] || '未知',
        // 興櫃可能沒有詳細財務數據，返回基本資訊
        eps: null,
        revenue: null,
        date: new Date().toISOString().split('T')[0]
    };
}