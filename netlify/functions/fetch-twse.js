const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const type = event.queryStringParameters?.type;
    const stockId = event.queryStringParameters?.stock_id;

    // === 新增：結構化財務數據查詢 ===
    if (type === 'financials' && stockId) {
        return await getStructuredFinancials(stockId, headers);
    }

    // === 原有邏輯：獲取原始數據 (保留給舊邏輯使用) ===
    const sources = {
        quarterly: ['https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci'], // 僅保留有效端點示例
        stocks: ['https://openapi.twse.com.tw/v1/opendata/t187ap03_L']
    };

    const targetUrls = sources[type];
    if (targetUrls) {
         try {
            const requests = targetUrls.map(url => fetch(url).then(r => r.ok ? r.json() : []).catch(() => []));
            const results = await Promise.all(requests);
            return { statusCode: 200, headers, body: JSON.stringify(results.flat()) };
        } catch (e) { return { statusCode: 500, headers, body: JSON.stringify([]) }; }
    }
    
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
};

// === 核心：結構化財務數據處理 ===
async function getStructuredFinancials(stockId, headers) {
    try {
        console.log(`開始獲取股票 ${stockId} 的結構化財務數據`);

        // 1. 並行抓取：只抓取穩定且存在的端點 (損益表、資產負債表、月營收)
        // 根據指南，損益表已包含 EPS 和 毛利率，不需要額外的比率 API
        const [incomeRes, balanceRes, revenueRes] = await Promise.all([
            // 綜合損益表 (含 EPS, 毛利, 淨利) - 涵蓋所有產業別
            Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci'), // 一般業
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh'), // 金融
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd'), // 營造
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins') // 保險
            ]).then(rs => Promise.all(rs.map(r => r.ok ? r.json().catch(()=>[]) : []))),
            
            // 資產負債表 (用於計算 ROE)
            Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_fh'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_bd'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ins')
            ]).then(rs => Promise.all(rs.map(r => r.ok ? r.json().catch(()=>[]) : []))),
            
            // 月營收 (月增率、年增率)
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L')
                .then(r => r.ok ? r.json().catch(()=>[]) : [])
                .catch(() => [])
        ]);

        // 2. 過濾出該股票的數據
        const allIncome = incomeRes.flat().filter(row => row['公司代號'] === stockId || row['公司代碼'] === stockId);
        const allBalance = balanceRes.flat().filter(row => row['公司代號'] === stockId || row['公司代碼'] === stockId);
        const allRevenue = Array.isArray(revenueRes) ? revenueRes.filter(row => row['公司代號'] === stockId || row['公司代碼'] === stockId) : [];

        // 3. 解析並計算所有週期的數據
        const result = parseFinancialData(allIncome, allBalance, allRevenue);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('getStructuredFinancials error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
}

// === 核心：數據解析與計算函數 ===
function parseFinancialData(incomeData, balanceData, revenueData) {
    const result = {
        eps: { quarters: {}, year: 'N/A' },
        roe: { quarters: {}, year: 'N/A' },
        revenueGrowth: { months: {}, quarters: {}, year: 'N/A' },
        profitMargin: { quarters: {}, year: 'N/A' },
        source: 'TWSE (Computed)'
    };

    // === 1. 解析 EPS & 毛利率 (來自綜合損益表) ===
    // 根據指南：年度數據 "資料年月"=YYYY, 季度數據 "資料年月"=YYYYQx
    incomeData.forEach(row => {
        const yearMonth = row['資料年月'] || row['年度']; // 兼容欄位
        const isYearly = yearMonth && yearMonth.length === 4; // 如 "2024"
        const isQuarterly = yearMonth && yearMonth.includes('Q'); // 如 "2024Q2"
        const periodKey = isYearly ? 'year' : (isQuarterly ? yearMonth.slice(-2) : null); // "year" 或 "Q2"

        if (!periodKey) return;

        // --- EPS 處理 ---
        const epsRaw = row['基本每股盈餘（元）'] || row['EPS'];
        const eps = parseFloat(String(epsRaw || '').replace(/,/g, ''));
        if (!isNaN(eps)) {
            if (isYearly) result.eps.year = eps;
            else result.eps.quarters[periodKey] = eps;
        }

        // --- 毛利率處理 (優先讀取欄位，沒有則計算) ---
        // 指南: 毛利率 = (營業毛利 / 營業收入) * 100
        let margin = parseFloat(String(row['營業毛利率(%)'] || row['營業毛利率'] || '').replace(/,/g, ''));
        
        if (isNaN(margin)) {
            // 如果 API 沒給毛利率欄位，進行人工計算
            const rev = parseFloat(String(row['營業收入'] || '').replace(/,/g, ''));
            const gross = parseFloat(String(row['營業毛利'] || '').replace(/,/g, ''));
            if (!isNaN(rev) && !isNaN(gross) && rev !== 0) {
                margin = (gross / rev) * 100;
            }
        }

        if (!isNaN(margin)) {
            if (isYearly) result.profitMargin.year = parseFloat(margin.toFixed(2));
            else result.profitMargin.quarters[periodKey] = parseFloat(margin.toFixed(2));
        }

        // --- ROE 計算 (需要搭配資產負債表) ---
        // 指南: ROE = 淨利 / 股東權益
        const netIncome = parseFloat(String(row['本期淨利（淨損）'] || row['淨利（淨損）歸屬於母公司業主'] || '').replace(/,/g, ''));
        
        if (!isNaN(netIncome)) {
            // 尋找對應期間的資產負債表
            const balanceRow = balanceData.find(b => (b['資料年月'] || b['年度']) === yearMonth);
            if (balanceRow) {
                const equity = parseFloat(String(balanceRow['股東權益總額'] || balanceRow['權益總額'] || '').replace(/,/g, ''));
                if (!isNaN(equity) && equity !== 0) {
                    const roe = (netIncome / equity) * 100;
                    if (isYearly) result.roe.year = parseFloat(roe.toFixed(2));
                    else result.roe.quarters[periodKey] = parseFloat(roe.toFixed(2));
                }
            }
        }
    });

    // === 2. 解析 營收成長率 (來自月營收表) ===
    if (revenueData.length > 0) {
        // 排序：最新的月份在最前面
        const sortedRevenue = [...revenueData].sort((a, b) => (b['資料年月'] || '').localeCompare(a['資料年月'] || ''));
        const latest = sortedRevenue[0];

        // 月增率
        if (latest) {
             const mGrowth = parseFloat(String(latest['營業收入-去年同月增減(%)'] || '').replace(/,/g, ''));
             if (!isNaN(mGrowth)) result.revenueGrowth.months['Latest'] = mGrowth;
             
             // 年增率 (使用當前月份的「累計」年增率作為當年度代表)
             // 指南提到 "營業收入-去年累計增減(%)"
             const yGrowth = parseFloat(String(latest['營業收入-去年累計增減(%)'] || latest['累計營業收入-去年同期增減(%)'] || '').replace(/,/g, ''));
             if (!isNaN(yGrowth)) result.revenueGrowth.year = yGrowth;
        }

        // 季增率計算
        result.revenueGrowth.quarters = calculateQuarterlyRevenueGrowth(revenueData);
    }

    return result;
}

// 輔助：計算季營收成長
function calculateQuarterlyRevenueGrowth(revenueData) {
    const quarterRates = {};
    const revenueByYearQ = {}; // { '2024Q1': 3000, '2023Q1': 2500 }

    // 1. 將月營收聚合為季營收
    revenueData.forEach(row => {
        const ym = row['資料年月']; // "202401"
        if (!ym || ym.length !== 6) return;
        
        const year = ym.substring(0, 4);
        const month = parseInt(ym.substring(4, 6));
        const rev = parseFloat(String(row['營業收入'] || '0').replace(/,/g, ''));
        
        const q = Math.ceil(month / 3);
        const key = `${year}Q${q}`;
        
        if (!revenueByYearQ[key]) revenueByYearQ[key] = 0;
        revenueByYearQ[key] += rev;
    });

    // 2. 計算 YoY 成長率
    Object.keys(revenueByYearQ).forEach(key => {
        const year = parseInt(key.substring(0, 4));
        const q = key.substring(4); // "Q1"
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