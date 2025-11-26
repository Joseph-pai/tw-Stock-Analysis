const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const type = event.queryStringParameters?.type;
    const stockId = event.queryStringParameters?.stock_id;

    if (type === 'financials' && stockId) {
        return await getStructuredFinancials(stockId, headers);
    }
    
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type or missing stock_id' }) };
};

/**
 * 根據股票代號獲取結構化財務數據
 * @param {string} stockId - 股票代號 (e.g., "2330")
 * @param {object} headers - 響應標頭
 * @returns {Promise<object>} 包含財務指標的物件
 */
async function getStructuredFinancials(stockId, headers) {
    console.log(`開始獲取股票 ${stockId} 的結構化財務數據`);
    const result = {
        eps: { quarters: {}, year: 'N/A' },
        roe: { quarters: {}, year: 'N/A' },
        revenueGrowth: { months: {}, quarters: {}, year: 'N/A' },
        profitMargin: { quarters: {}, year: 'N/A' },
        source: 'TWSE (Multi-API v2)'
    };

    try {
        // 1. 並行抓取所有必要的 API 端點數據
        console.log("正在並行抓取綜合損益表、資產負債表及營益分析表...");
        const [incomeStatementData, balanceSheetData, financialAnalysisData] = await Promise.all([
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_X_ci').then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : []),
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_X_ci').then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : []),
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap17_L').then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : [])
        ]);
        
        console.log(`原始數據獲取成功: 損益表(${incomeStatementData.length}筆), 資產負債表(${balanceSheetData.length}筆), 營益分析(${financialAnalysisData.length}筆)`);

        // 2. 從各 API 數據中過濾出目標公司的數據
        const targetIncomeData = incomeStatementData.filter(row => String(row['公司代號'] || '') === String(stockId));
        const targetBalanceData = balanceSheetData.filter(row => String(row['公司代號'] || '') === String(stockId));
        const targetFinancialData = financialAnalysisData.filter(row => String(row['公司代號'] || '') === String(stockId));

        console.log(`過濾後數據: 損益表(${targetIncomeData.length}筆), 資產負債表(${targetBalanceData.length}筆), 營益分析(${targetFinancialData.length}筆)`);

        if (targetIncomeData.length === 0 && targetBalanceData.length === 0) {
            console.warn(`未在 API 中找到股票 ${stockId} 的財務數據，可能為上櫃或非一般業類型。`);
            return { statusCode: 404, headers, body: JSON.stringify({ error: `Financial data not found for stock ${stockId}.` }) };
        }

        // 3. 處理數據，計算各種財務指標
        // 假設數據已按時間排序 (舊到新)，取倒數第一筆為最新季，倒數第五筆為去年同季 (需有至少5季資料)
        const latestQuarterData = targetIncomeData.length > 0 ? targetIncomeData[targetIncomeData.length - 1] : null;
        const latestBalanceData = targetBalanceData.length > 0 ? targetBalanceData[targetBalanceData.length - 1] : null;
        const latestFinancialData = targetFinancialData.length > 0 ? targetFinancialData[targetFinancialData.length - 1] : null;

        if (!latestQuarterData) {
            console.warn("無法獲取最新的綜合損益表數據。");
            // 如果沒有損益表數據，則大部分指標無法計算，直接返回 result 的初始值
        } else {
            const year = latestQuarterData['年度'];
            const quarter = latestQuarterData['季別'];
            const qKey = `Q${quarter}`;
            
            // --- EPS (每股盈餘) ---
            const epsValue = parseNumericValue(latestQuarterData['基本每股盈餘（元）']);
            if (!isNaN(epsValue)) {
                result.eps.quarters[qKey] = epsValue;
                result.eps.year = epsValue; // 年度 EPS 通常取最新季的數值
            }

            // --- ROE (股東權益報酬率) ---
            if (latestBalanceData) {
                const netIncome = parseNumericValue(latestQuarterData['淨利（淨損）歸屬於母公司業主']);
                const shareholdersEquity = parseNumericValue(latestBalanceData['歸屬於母公司業主之權益合計']);

                if (!isNaN(netIncome) && !isNaN(shareholdersEquity) && shareholdersEquity > 0) {
                    const roeValue = (netIncome / shareholdersEquity) * 100;
                    result.roe.quarters[qKey] = parseFloat(roeValue.toFixed(2));
                    result.roe.year = parseFloat(roeValue.toFixed(2)); // 季度 ROE 作為年度參考
                }
            }

            // --- 毛利率 ---
            const revenue = parseNumericValue(latestQuarterData['營業收入']);
            const cost = parseNumericValue(latestQuarterData['營業成本']);
            if (!isNaN(revenue) && !isNaN(cost) && revenue > 0) {
                const profitMargin = ((revenue - cost) / revenue) * 100;
                result.profitMargin.quarters[qKey] = parseFloat(profitMargin.toFixed(2));
                result.profitMargin.year = parseFloat(profitMargin.toFixed(2)); // 季度毛利率作為年度參考
            }
        }
        
        // 4. 使用 t187ap17_L API 獲取更穩定的營收成長率 (該 API 專門提供此類比較數據)
        if (latestFinancialData) {
            const year = latestFinancialData['年度'];
            const revenueGrowthValue = parseNumericValue(latestFinancialData['前期比較增減(%)']);
            if (!isNaN(revenueGrowthValue)) {
                 result.revenueGrowth.year = parseFloat(revenueGrowthValue.toFixed(2));
            }
        }

    } catch (error) {
        console.error('getStructuredFinancials error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }

    console.log(`財務數據獲取完畢: ${JSON.stringify(result, null, 2)}`);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result)
    };
}

/**
 * 輔助函數：將包含千分位逗號的字串轉換為浮點數
 * @param {string} value - 需要轉換的值
 * @returns {number} 轉換後的數字，如果無法轉換則返回 NaN
 */
function parseNumericValue(value) {
    if (value === undefined || value === null || value === '') {
        return NaN;
    }
    const parsed = parseFloat(String(value).replace(/,/g, ''));
    return isNaN(parsed) ? NaN : parsed;
}
