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
    
    // 其他類型的邏輯可以保留或處理
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type or missing stock_id' }) };
};

// === 核心：基於最新 API 的結構化財務數據處理 ===
async function getStructuredFinancials(stockId, headers) {
    console.log(`開始獲取股票 ${stockId} 的結構化財務數據`);
    
    // 根據新 API，我們需要根據產業類別呼叫不同的端點
    // 這裡先假設為 "一般業" (ci)，你可以根據需要擴充邏輯
    // 或者在前端先獲取公司基本資料 (t187ap03_L) 判斷產業類別
    const industry = 'ci'; // 'ci'=一般業, 'fh'=金控, 'bd'=證券期貨, 'ins'=保險

    const result = {
        eps: { quarters: {}, year: 'N/A' },
        roe: { quarters: {}, year: 'N/A' },
        revenueGrowth: { months: {}, quarters: {}, year: 'N/A' },
        profitMargin: { quarters: {}, year: 'N/A' },
        source: 'TWSE (Latest API)'
    };

    try {
        // 1. 並行抓取所有必要的 API 端點
        const [incomeRes, balanceRes, revenueRes] = await Promise.all([
            fetch(`https://openapi.twse.com.tw/v1/opendata/t187ap06_X_${industry}`).then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : []),
            fetch(`https://openapi.twse.com.tw/v1/opendata/t187ap07_X_${industry}`).then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : []),
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_P').then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : [])
        ]);
        
        // --- 調試輸出 ---
        console.log(`綜合損益表筆數: ${incomeRes.length}`);
        console.log(`資產負債表筆數: ${balanceRes.length}`);
        console.log(`月營收表筆數: ${revenueRes.length}`);
        // --------------

        // 2. 過濾出該股票的數據，並確保資料結構正確
        const allIncome = incomeRes.filter(row => String(row['公司代號'] || '') === String(stockId));
        const allBalance = balanceRes.filter(row => String(row['公司代號'] || '') === String(stockId));
        const allRevenue = revenueRes.filter(row => String(row['公司代號'] || '') === String(stockId));

        // --- 調試輸出 ---
        console.log(`過濾後 綜合損益表筆數: ${allIncome.length}`);
        if (allIncome.length > 0) console.log("範例綜合損益表資料:", allIncome[0]);
        console.log(`過濾後 資產負債表筆數: ${allBalance.length}`);
        if (allBalance.length > 0) console.log("範例資產負債表資料:", allBalance[0]);
        console.log(`過濾後 月營收表筆數: ${allRevenue.length}`);
        if (allRevenue.length > 0) console.log("範例月營收表資料:", allRevenue[0]);
        // --------------

        // 3. 解析並計算所有週期的數據
        if (allIncome.length > 0 && allBalance.length > 0) {
            parseFinancialData(allIncome, allBalance, result);
        }
        if (allRevenue.length > 0) {
            parseRevenueData(allRevenue, result);
        }

    } catch (error) {
        console.error('getStructuredFinancials error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result)
    };
}

// === 核心：數據解析與計算函數 (基於新 API 欄位) ===
function parseFinancialData(incomeData, balanceData, result) {
    // 從最新到最舊排序
    const sortedIncome = [...incomeData].sort((a, b) => String(b['年度'] || b['出表日期'] || '').localeCompare(String(a['年度'] || a['出表日期'] || '')));
    
    for (const row of sortedIncome) {
        // 根據新 API，年度資料在 '年度' 欄位，季度資料在 '季別' 欄位
        const year = row['年度'];
        const quarter = row['季別'];
        const isYearlyData = year && !quarter;
        const isQuarterlyData = year && quarter;

        // --- 年度資料解析 ---
        if (isYearlyData) {
            // --- EPS ---
            // 新 API 欄位: "基本每股盈餘（元）"
            const eps = parseFloat(String(row['基本每股盈餘（元）'] || '').replace(/,/g, ''));
            if (!isNaN(eps)) result.eps.year = eps;

            // --- 毛利率 ---
            // 新 API 欄位: "毛利率(%)(營業毛利)/(營業收入)"
            const margin = parseFloat(String(row['毛利率(%)(營業毛利)/(營業收入)'] || '').replace(/,/g, ''));
            if (!isNaN(margin)) result.profitMargin.year = parseFloat(margin.toFixed(2));
            
            // --- ROE (需要對應年度的資產負債表) ---
            // 新 API 欄位: "本期淨利（淨損）", "歸屬於母公司業主之權益合計"
            const netIncome = parseFloat(String(row['本期淨利（淨損）'] || '').replace(/,/g, ''));
            if (!isNaN(netIncome)) {
                const balanceRow = balanceData.find(b => String(b['年度'] || '') === year);
                if (balanceRow) {
                    const equity = parseFloat(String(balanceRow['歸屬於母公司業主之權益合計'] || '').replace(/,/g, ''));
                    if (!isNaN(equity) && equity > 0) {
                        const roe = (netIncome / equity) * 100;
                        result.roe.year = parseFloat(roe.toFixed(2));
                        // 年度資料找到後即可跳出
                        break;
                    }
                }
            }
        }
        
        // --- 季度資料解析 ---
        if (isQuarterlyData) {
            const qKey = quarter; // 例如 "1", "2", "3", "4"
            
            // --- EPS ---
            const eps = parseFloat(String(row['基本每股盈餘（元）'] || '').replace(/,/g, ''));
            if (!isNaN(eps)) result.eps.quarters[`Q${qKey}`] = eps;

            // --- 毛利率 ---
            const margin = parseFloat(String(row['毛利率(%)(營業毛利)/(營業收入)'] || '').replace(/,/g, ''));
            if (!isNaN(margin)) result.profitMargin.quarters[`Q${qKey}`] = parseFloat(margin.toFixed(2));
            
            // --- ROE (需要對應季度的資產負債表) ---
            const netIncome = parseFloat(String(row['本期淨利（淨損）'] || '').replace(/,/g, ''));
            if (!isNaN(netIncome)) {
                const balanceRow = balanceData.find(b => String(b['年度'] || '') === year && String(b['季別'] || '') === quarter);
                if (balanceRow) {
                    const equity = parseFloat(String(balanceRow['歸屬於母公司業主之權益合計'] || '').replace(/,/g, ''));
                    if (!isNaN(equity) && equity > 0) {
                        const roe = (netIncome / equity) * 100;
                        result.roe.quarters[`Q${qKey}`] = parseFloat(roe.toFixed(2));
                    }
                }
            }
        }
    }
}

function parseRevenueData(revenueData, result) {
    // 從最新到最舊排序
    const sortedRevenue = [...revenueData].sort((a, b) => String(b['資料年月'] || '').localeCompare(String(a['資料年月'] || '')));
    const latest = sortedRevenue[0];

    if (latest) {
        // 月增率 (取最新月份的)
        // 新 API 欄位: "營業收入-上月比較增減(%)"
        const mGrowth = parseFloat(String(latest['營業收入-上月比較增減(%)'] || '').replace(/,/g, ''));
        if (!isNaN(mGrowth)) result.revenueGrowth.months['Latest'] = mGrowth;

        // 年增率 (取最新月份的年增率，代表當前累計)
        // 新 API 欄位: "營業收入-去年同月增減(%)"
        const yGrowth = parseFloat(String(latest['營業收入-去年同月增減(%)'] || '').replace(/,/g, ''));
        if (!isNaN(yGrowth)) result.revenueGrowth.year = yGrowth;
    }
    
    // 季增率計算邏輯不變，但要注意 revenueData 的欄位名稱
    // 月營收表 (t187ap05_P) 的欄位:
    // "資料年月", "公司代號", "營業收入-當月營收"
    result.revenueGrowth.quarters = calculateQuarterlyRevenueGrowth(revenueData);
}

// 輔助：計算季營收成長 (邏輯不變，但欄位名稱已更新)
function calculateQuarterlyRevenueGrowth(revenueData) {
    const revenueByYearQ = {};

    revenueData.forEach(row => {
        const ym = row['資料年月']; // "202401"
        if (!ym || ym.length !== 6) return;
        
        const year = ym.substring(0, 4);
        const month = parseInt(ym.substring(4, 6));
        const q = `Q${Math.ceil(month / 3)}`;
        const key = `${year}${q}`;
        
        // 新 API 欄位: "營業收入-當月營收"
        const rev = parseFloat(String(row['營業收入-當月營收'] || '0').replace(/,/g, ''));
        if (!isNaN(rev)) {
            revenueByYearQ[key] = (revenueByYearQ[key] || 0) + rev;
        }
    });

    const quarterRates = {};
    Object.keys(revenueByYearQ).forEach(key => {
        const year = parseInt(key.substring(0, 4));
        const q = key.substring(4);
        const prevKey = `${year - 1}${q}`;
        
        const currentRev = revenueByYearQ[key];
        const prevRev = revenueByYearQ[prevKey];

        if (prevRev && prevRev > 0) {
            const growth = ((currentRev - prevRev) / prevRev) * 100;
            quarterRates[q] = parseFloat(growth.toFixed(2));
        }
    });

    return quarterRates;
}
