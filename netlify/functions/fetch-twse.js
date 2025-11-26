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

    // === 結構化財務數據查詢 ===
    if (type === 'financials' && stockId) {
        return await getStructuredFinancials(stockId, headers);
    }

    // === 原有邏輯：獲取原始數據 (保留兼容性) ===
    const sources = {
        quarterly: ['https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci'],
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

        // 1. 並行抓取：只抓取穩定且存在的端點
        const [incomeRes, balanceRes, revenueRes] = await Promise.all([
            // 綜合損益表 (含 EPS, 毛利, 淨利)
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
            
            // 月營收
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L')
                .then(r => r.ok ? r.json().catch(()=>[]) : [])
                .catch(() => [])
        ]);

        // 2. 過濾數據
        const allIncome = incomeRes.flat().filter(row => row['公司代號'] === stockId || row['公司代碼'] === stockId);
        const allBalance = balanceRes.flat().filter(row => row['公司代號'] === stockId || row['公司代碼'] === stockId);
        const allRevenue = Array.isArray(revenueRes) ? revenueRes.filter(row => row['公司代號'] === stockId || row['公司代碼'] === stockId) : [];

        // 3. 解析並計算
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

// === 核心：數據解析函數 (包含自動計算與 EPS 期間修正) ===
function parseFinancialData(incomeData, balanceData, revenueData) {
    const result = {
        eps: { quarters: {}, year: 'N/A' },
        roe: { quarters: {}, year: 'N/A' },
        revenueGrowth: { months: {}, quarters: {}, year: 'N/A' },
        profitMargin: { quarters: {}, year: 'N/A' },
        source: 'TWSE (Computed)'
    };

    // 輔助：排序數據 (確保 Q1, Q2, Q3 順序正確以便計算差額)
    const sortedIncome = [...incomeData].sort((a, b) => (a['資料年月'] || '').localeCompare(b['資料年月'] || ''));

    // 暫存累計 EPS 以便計算單季差額
    // Key: Year, Value: { Q1: 1.2, Q2: 3.5 ... } (皆為累計值)
    const cumulativeEPSData = {};

    // === 1. 解析 損益表 (EPS, 毛利率) ===
    sortedIncome.forEach(row => {
        const yearMonth = row['資料年月'] || row['年度']; 
        if (!yearMonth) return;

        const isYearly = yearMonth.length === 4; // "2024"
        const isQuarterly = yearMonth.includes('Q'); // "2024Q3"
        const year = yearMonth.substring(0, 4);
        const qKey = isQuarterly ? yearMonth.slice(-2) : null; // "Q1", "Q2"...

        // --- EPS 處理 (修正：將累計值歸入 Year，計算單季值) ---
        let epsRaw = row['基本每股盈餘（元）'] || row['EPS'];
        let eps = parseFloat(String(epsRaw || '').replace(/,/g, ''));

        if (!isNaN(eps)) {
            if (isYearly) {
                // 年度報告直接是當年的總 EPS
                result.eps.year = eps;
            } else if (isQuarterly) {
                // 初始化該年度的累計記錄
                if (!cumulativeEPSData[year]) cumulativeEPSData[year] = {};
                cumulativeEPSData[year][qKey] = eps;

                // 總是將最新的累計 EPS 更新為年度 EPS (因為季報通常是累計的，如 Q3 是前三季總和)
                // 這解決了 46.75 顯示在季度的問題
                result.eps.year = eps; 

                // 計算單季獨立 EPS
                let discreteEPS = eps;
                if (qKey === 'Q2') {
                    const prev = cumulativeEPSData[year]['Q1'];
                    if (prev !== undefined) discreteEPS = eps - prev;
                } else if (qKey === 'Q3') {
                    const prev = cumulativeEPSData[year]['Q2'];
                    if (prev !== undefined) discreteEPS = eps - prev;
                } else if (qKey === 'Q4') {
                    const prev = cumulativeEPSData[year]['Q3'];
                    if (prev !== undefined) discreteEPS = eps - prev;
                }

                result.eps.quarters[qKey] = parseFloat(discreteEPS.toFixed(2));
            }
        }

        // --- 毛利率處理 (自動計算：若無欄位則自行計算) ---
        let margin = parseFloat(String(row['營業毛利率(%)'] || row['營業毛利率'] || '').replace(/,/g, ''));
        
        // 補算邏輯：(營業毛利 / 營業收入) * 100
        if (isNaN(margin)) {
            const rev = parseFloat(String(row['營業收入'] || '').replace(/,/g, ''));
            const gross = parseFloat(String(row['營業毛利'] || '').replace(/,/g, ''));
            if (!isNaN(rev) && !isNaN(gross) && rev !== 0) {
                margin = (gross / rev) * 100;
            }
        }

        if (!isNaN(margin)) {
            if (isYearly) result.profitMargin.year = parseFloat(margin.toFixed(2));
            else if (qKey) result.profitMargin.quarters[qKey] = parseFloat(margin.toFixed(2));
        }

        // --- ROE 計算 (自動計算：淨利 / 股東權益) ---
        let netIncomeRaw = row['本期淨利（淨損）'] || row['淨利（淨損）歸屬於母公司業主'];
        const netIncome = parseFloat(String(netIncomeRaw || '').replace(/,/g, ''));
        
        if (!isNaN(netIncome)) {
            // 找對應期間的資產負債表
            const balanceRow = balanceData.find(b => (b['資料年月'] || b['年度']) === yearMonth);
            if (balanceRow) {
                const equityRaw = balanceRow['股東權益總額'] || balanceRow['權益總額'] || balanceRow['權益-歸屬於母公司業主'];
                const equity = parseFloat(String(equityRaw || '').replace(/,/g, ''));
                
                if (!isNaN(equity) && equity !== 0) {
                    const roe = (netIncome / equity) * 100;
                    if (isYearly) result.roe.year = parseFloat(roe.toFixed(2));
                    else if (qKey) result.roe.quarters[qKey] = parseFloat(roe.toFixed(2));
                }
            }
        }
    });

    // === 2. 解析 營收成長率 ===
    if (revenueData.length > 0) {
        // 排序：最新的月份在最前面
        const sortedRevenue = [...revenueData].sort((a, b) => (b['資料年月'] || '').localeCompare(a['資料年月'] || ''));
        const latest = sortedRevenue[0];

        // 月增率與年增率 (API 直接提供或透過計算)
        if (latest) {
             const mGrowth = parseFloat(String(latest['營業收入-去年同月增減(%)'] || '').replace(/,/g, ''));
             if (!isNaN(mGrowth)) result.revenueGrowth.months['Latest'] = mGrowth;
             
             const yGrowth = parseFloat(String(latest['營業收入-去年累計增減(%)'] || latest['累計營業收入-去年同期增減(%)'] || '').replace(/,/g, ''));
             if (!isNaN(yGrowth)) result.revenueGrowth.year = yGrowth;
        }

        // 計算季營收成長
        result.revenueGrowth.quarters = calculateQuarterlyRevenueGrowth(revenueData);
    }

    return result;
}

// 輔助：計算季營收成長
function calculateQuarterlyRevenueGrowth(revenueData) {
    const quarterRates = {};
    const revenueByYearQ = {}; 

    revenueData.forEach(row => {
        const ym = row['資料年月']; 
        if (!ym || ym.length !== 6) return;
        
        const year = ym.substring(0, 4);
        const month = parseInt(ym.substring(4, 6));
        const rev = parseFloat(String(row['營業收入'] || '0').replace(/,/g, ''));
        
        const q = Math.ceil(month / 3);
        const key = `${year}Q${q}`;
        
        if (!revenueByYearQ[key]) revenueByYearQ[key] = 0;
        revenueByYearQ[key] += rev;
    });

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