const fetch = require('node-fetch');

// 輔助函數：計算最近季營收增長率（與前一季比較）。
/**
 * @param {Array<Array>} monthlyRevRows - 股票代碼和年份篩選後的月營收數據 [公司代碼, 資料年月(YYYYMM), 營業收入, ...]
 * @param {string} currentYear - 查詢年份 (YYYY)
 * @param {string} currentQ - 查詢季度 (Q1, Q2, Q3, Q4)
 * @returns {number | null} 季營收增率(%)
 */
function calculateQuarterlyGrowth(monthlyRevRows, currentYear, currentQ) {
    // 1. 定義當前季度和前一季度的月份
    const Q_MAP = {
        'Q1': ['01', '02', '03'],
        'Q2': ['04', '05', '06'],
        'Q3': ['07', '08', '09'],
        'Q4': ['10', '11', '12']
    };
    
    // 計算前一季度的年份和代號 (處理跨年情況)
    let prevYear = parseInt(currentYear);
    let prevQ;

    switch(currentQ) {
        case 'Q1': prevYear -= 1; prevQ = 'Q4'; break;
        case 'Q2': prevQ = 'Q1'; break;
        case 'Q3': prevQ = 'Q2'; break;
        case 'Q4': prevQ = 'Q3'; break;
        default: return null;
    }
    
    const currentMonths = Q_MAP[currentQ].map(m => `${currentYear}${m}`);
    const previousMonths = Q_MAP[prevQ].map(m => `${prevYear}${m}`);

    // 2. 累加營收 (假設營業收入在月營收數據的索引 2)
    const getCurrentRevenue = (monthCode) => {
        // 篩選出對應月份的營收數據
        const row = monthlyRevRows.find(row => row[1] === monthCode);
        // row[2] 假設是營業收入欄位
        return row && row[2] ? parseFloat(row[2]) : 0; 
    };

    const currentQuarterRevenue = currentMonths.reduce((sum, month) => sum + getCurrentRevenue(month), 0);
    const previousQuarterRevenue = previousMonths.reduce((sum, month) => sum + getCurrentRevenue(month), 0);
    
    // 3. 計算增長率
    if (previousQuarterRevenue > 0 && currentQuarterRevenue !== 0) {
        // 季營收增率 = (本季營收 - 上季營收) / 上季營收 × 100
        return ((currentQuarterRevenue - previousQuarterRevenue) / previousQuarterRevenue) * 100;
    }

    return null;
}


// 輔助函數：處理 TWSE API 獲取的數據並進行人工計算
/**
 * @param {Array<Array>} combinedData - 從 TWSE API 獲取的所有原始數據 (陣列的陣列)。
 * @param {string} code - 股票代碼。
 * @param {string} year - 查詢年份 (YYYY)。
 * @param {string} [quarter] - 查詢季度 (Q1, Q2, Q3, Q4)。
 */
function processFinancialData(combinedData, code, year, quarter) {
    const targetPeriod = quarter ? `${year}${quarter}` : year;
    const yearEndPeriod = `${year}Q4`; 

    // 篩選數據 (TWSE API 回傳為陣列的陣列，欄位位置固定，這裡假設了常見的索引)
    // 綜合損益表 (t187ap06_L_ci): 假設 Net Income 在 row[6], 毛利率在 row[5], EPS 在 row[7] 或 row[8]
    const incomeStmt = combinedData.filter(row => row[0] === code && row.length > 5 && (row[1] === targetPeriod || (row[1].length === 4 && !quarter)));
    
    // 資產負債表 (t187ap07_L_ci): 假設 股東權益 (Equity) 在 row[4]
    const balanceSheet = combinedData.filter(row => row[0] === code && row.length > 3 && (row[1] === targetPeriod || row[1] === yearEndPeriod));
    
    // 月營收 (t187ap05_L): 假設 營業收入在 row[2], 月增率在 row[3], 年增率在 row[4]
    const monthlyRev = combinedData.filter(row => row[0] === code && row[1].length === 6);

    let results = {};
    let netIncome = null;
    
    // 獲取當期綜合損益數據
    const incomeRow = incomeStmt.find(row => row[1] === targetPeriod);
    
    // --- 1. EPS & 毛利率 (API 優先/人工計算) ---
    if (incomeRow) {
        // EPS (人工計算/API提供 - 取非 NaN 的值)
        const eps = parseFloat(incomeRow[7]) || parseFloat(incomeRow[8]); 
        if (!isNaN(eps)) results.EPS = parseFloat(eps.toFixed(2));

        // 毛利率 (API 提供/人工計算 - 假設在索引 5)
        const grossMarginRate = parseFloat(incomeRow[5]);
        if (!isNaN(grossMarginRate)) results.GrossMarginRate = parseFloat(grossMarginRate.toFixed(2));
        
        // 暫存淨利用於 ROE 計算 (假設在索引 6)
        netIncome = parseFloat(incomeRow[6]);
    }

    // --- 2. ROE (人工計算) ---
    if (netIncome !== null) {
        // 季度 ROE 使用季度末股東權益，年度 ROE 使用年度末 (Q4) 股東權益
        const equityTargetPeriod = quarter ? targetPeriod : yearEndPeriod;
        const equityRow = balanceSheet.find(row => row[1] === equityTargetPeriod);

        if (equityRow) {
            // 股東權益 (Equity) (假設在索引 4)
            const equity = parseFloat(equityRow[4]); 
            if (equity > 0) {
                // ROE(%) = (淨利 / 股東權益) × 100
                const roe = (netIncome / equity) * 100; // 人工計算
                results.ROE = parseFloat(roe.toFixed(2));
            }
        }
    }
    
    // --- 3. 月/季/年營收增率 ---
    if (monthlyRev.length > 0) {
        // 獲取最新的月營收數據，用於月增率和年增率 (年初累計)
        const latestRev = monthlyRev.sort((a, b) => b[1].localeCompare(a[1]))[0];
        
        if (latestRev) {
            // 月增率 (API 直接提供 - 假設在索引 3)
            const monthOverMonth = parseFloat(latestRev[3]);
            if (!isNaN(monthOverMonth)) results.MonthlyRevenueGrowth = parseFloat(monthOverMonth.toFixed(2));
            
            // 年增率 (API 直接提供 - 累積 - 假設在索引 4)
            const yearOverYear = parseFloat(latestRev[4]);
            if (!isNaN(yearOverYear)) results.AnnualRevenueGrowth = parseFloat(yearOverYear.toFixed(2));
        }

        // 季營收增率 (人工計算 - 僅在查詢季度時執行)
        if(quarter) {
            const qoqGrowth = calculateQuarterlyGrowth(monthlyRev, year, quarter);
            if(qoqGrowth !== null) {
                results.QuarterlyRevenueGrowth = parseFloat(qoqGrowth.toFixed(2));
            }
        }
    }

    // 格式化輸出
    return {
        stockCode: code,
        period: targetPeriod,
        data: results // 包含所有計算後的指標
    };
}


// Netlify 函數主入口
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const type = event.queryStringParameters.type; 

    const sources = {
        // [季度資料] 綜合損益表 + 資產負債表 + 月營收彙總表
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', // 綜合損益表
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci', // 補上資產負債表 (用於ROE計算)
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins',
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L' // 月營收彙總表 (用於營收增率計算)
        ],
        // [年度/分析資料]
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L',
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'
        ],
        // [月營收資料]
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if'
        ],
        // [股票清單]
        stocks: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    try {
        const requests = targetUrls.map(url => fetch(url).then(res => res.json()).catch(err => {
            console.error(`Error fetching ${url}:`, err);
            return null; // 失敗時返回 null
        }));

        const results = await Promise.all(requests);

        // 過濾掉失敗的請求並展開所有數據
        const combinedData = results.filter(data => data && Array.isArray(data)).flat();

        // --- 處理 'quarterly' 類型並執行人工計算 (最新財報數據) ---
        if (type === 'quarterly') {
            const stockCode = event.queryStringParameters.stockCode;
            const targetYear = event.queryStringParameters.year;
            const targetQ = event.queryStringParameters.quarter; 
            
            // 只有當所有必要參數都存在時才進行計算
            if (stockCode && targetYear && targetQ) {
                const processedData = processFinancialData(combinedData, stockCode, targetYear, targetQ);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(processedData),
                };
            }
            // 如果缺少參數，則返回原始數據，讓前端自行處理錯誤或篩選
        }
        
        // 對於其他類型或缺少參數的 quarterly 請求，返回合併的原始數據
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(combinedData),
        };

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Internal server error: ${error.message}` }),
        };
    }
};