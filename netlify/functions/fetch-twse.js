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
    
    // 其他類型（如 stocks）的邏輯可以保留或處理
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type or missing stock_id' }) };
};

// === 核心：結構化財務數據處理 ===
async function getStructuredFinancials(stockId, headers) {
    console.log(`開始獲取股票 ${stockId} 的結構化財務數據`);
    const result = {
        eps: { quarters: {}, year: 'N/A' },
        roe: { quarters: {}, year: 'N/A' },
        revenueGrowth: { months: {}, quarters: {}, year: 'N/A' },
        profitMargin: { quarters: {}, year: 'N/A' },
        source: 'TWSE (Computed)'
    };

    try {
        // 1. 並行抓取所有必要的 API 端點
        const promises = [
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci').then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : []),
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci').then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : []),
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L').then(r => r.ok ? r.json().then(d => d.data || []).catch(() => []) : [])
        ];
        
        const [incomeData, balanceData, revenueData] = await Promise.all(promises);

        // --- 調試輸出 ---
        console.log(`財損益表筆數: ${incomeData.length}`);
        console.log(`資產負債表筆數: ${balanceData.length}`);
        console.log(`月營收表筆數: ${revenueData.length}`);
        // --------------

        // 2. 過濾出該股票的數據，並確保資料結構正確
        const allIncome = incomeData.filter(row => String(row['公司代碼'] || row['公司代號'] || '') === String(stockId));
        const allBalance = balanceData.filter(row => String(row['公司代碼'] || row['公司代號'] || '') === String(stockId));
        const allRevenue = revenueData.filter(row => String(row['公司代碼'] || row['公司代號'] || '') === String(stockId));

        // --- 調試輸出 ---
        console.log(`過濾後 財損益表筆數: ${allIncome.length}`);
        if (allIncome.length > 0) console.log("範例財損益表資料:", allIncome[0]);
        console.log(`過濾後 資產負債表筆數: ${allBalance.length}`);
        if (allBalance.length > 0) console.log("範例資產負債表資料:", allBalance[0]);
        console.log(`過濾後 月營收表筆數: ${allRevenue.length}`);
        if (allRevenue.length > 0) console.log("範例月營收表資料:", allRevenue[0]);
        // --------------

        // 3. 解析並計算所有週期的數據
        if (allIncome.length > 0) {
            parseIncomeAndBalance(allIncome, allBalance, result);
        }
        if (allRevenue.length > 0) {
            parseRevenue(allRevenue, result);
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


// === 核心：數據解析與計算函數 (修正版) ===
function parseIncomeAndBalance(incomeData, balanceData, result) {
    // 從最新到最舊排序
    const sortedIncome = [...incomeData].sort((a, b) => String(b['資料年月'] || '').localeCompare(String(a['資料年月'] || '')));
    
    for (const row of sortedIncome) {
        const yearMonth = row['資料年月'] || '';
        const year = yearMonth.substring(0, 4);

        // 年度資料 (例如 "2024")
        if (yearMonth.length === 4) {
            // --- EPS ---
            const eps = parseFloat(String(row['基本每股盈餘（元）'] || row['EPS'] || '').replace(/,/g, ''));
            if (!isNaN(eps)) result.eps.year = eps;

            // --- 毛利率 ---
            let margin = parseFloat(String(row['營業毛利率(%)'] || '').replace(/,/g, ''));
            if (isNaN(margin)) {
                const rev = parseFloat(String(row['營業收入'] || '').replace(/,/g, ''));
                const gross = parseFloat(String(row['營業毛利'] || '').replace(/,/g, ''));
                if (!isNaN(rev) && !isNaN(gross) && rev > 0) {
                    margin = (gross / rev) * 100;
                }
            }
            if (!isNaN(margin)) result.profitMargin.year = parseFloat(margin.toFixed(2));
            
            // --- ROE (需要對應年度的資產負債表) ---
            const netIncome = parseFloat(String(row['本期淨利（淨損）'] || '').replace(/,/g, ''));
            if (!isNaN(netIncome)) {
                const balanceRow = balanceData.find(b => String(b['資料年月'] || '').substring(0, 4) === year);
                if (balanceRow) {
                    const equity = parseFloat(String(balanceRow['股東權益總額'] || '').replace(/,/g, ''));
                    if (!isNaN(equity) && equity > 0) {
                        const roe = (netIncome / equity) * 100;
                        result.roe.year = parseFloat(roe.toFixed(2));
                        break; // 找到年度ROE後就可以結束迴圈
                    }
                }
            }
            break; // 找到年度資料後就可以結束迴圈 (因為已排序)
        }
        
        // 季度資料 (例如 "2024Q2")
        if (yearMonth.includes('Q')) {
            const quarter = yearMonth.slice(-2); // "Q2"
            
            // --- EPS ---
            const eps = parseFloat(String(row['基本每股盈餘（元）'] || row['EPS'] || '').replace(/,/g, ''));
            if (!isNaN(eps)) result.eps.quarters[quarter] = eps;

            // --- 毛利率 ---
            let margin = parseFloat(String(row['營業毛利率(%)'] || '').replace(/,/g, ''));
            if (isNaN(margin)) {
                const rev = parseFloat(String(row['營業收入'] || '').replace(/,/g, ''));
                const gross = parseFloat(String(row['營業毛利'] || '').replace(/,/g, ''));
                 if (!isNaN(rev) && !isNaN(gross) && rev > 0) {
                    margin = (gross / rev) * 100;
                }
            }
            if (!isNaN(margin)) result.profitMargin.quarters[quarter] = parseFloat(margin.toFixed(2));
            
            // --- ROE (需要對應季度的資產負債表) ---
            // 注意：季度ROE計算較複雜，這裡用該季度淨利除以該季度末股東權益
            const netIncome = parseFloat(String(row['本期淨利（淨損）'] || '').replace(/,/g, ''));
            if (!isNaN(netIncome)) {
                const balanceRow = balanceData.find(b => String(b['資料年月'] || '') === yearMonth);
                if (balanceRow) {
                    const equity = parseFloat(String(balanceRow['股東權益總額'] || '').replace(/,/g, ''));
                    if (!isNaN(equity) && equity > 0) {
                        const roe = (netIncome / equity) * 100;
                        result.roe.quarters[quarter] = parseFloat(roe.toFixed(2));
                    }
                }
            }
        }
    }
}

function parseRevenue(revenueData, result) {
    // 從最新到最舊排序
    const sortedRevenue = [...revenueData].sort((a, b) => String(b['資料年月'] || '').localeCompare(String(a['資料年月'] || '')));
    const latest = sortedRevenue[0];

    if (latest) {
        // 月增率 (取最新月份的)
        const mGrowth = parseFloat(String(latest['營業收入-上月增減(%)'] || '').replace(/,/g, ''));
        if (!isNaN(mGrowth)) result.revenueGrowth.months['Latest'] = mGrowth;

        // 年增率 (取最新月份的年增率，代表當前累計)
        const yGrowth = parseFloat(String(latest['營業收入-去年同月增減(%)'] || '').replace(/,/g, ''));
        if (!isNaN(yGrowth)) result.revenueGrowth.year = yGrowth;
    }
    
    // 季增率
    result.revenueGrowth.quarters = calculateQuarterlyRevenueGrowth(revenueData);
}

// 輔助：計算季營收成長
function calculateQuarterlyRevenueGrowth(revenueData) {
    const revenueByYearQ = {};

    revenueData.forEach(row => {
        const ym = row['資料年月'];
        if (!ym || ym.length !== 6) return;
        
        const year = ym.substring(0, 4);
        const month = parseInt(ym.substring(4, 6));
        const q = `Q${Math.ceil(month / 3)}`;
        const key = `${year}${q}`;
        
        const rev = parseFloat(String(row['營業收入'] || '0').replace(/,/g, ''));
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
