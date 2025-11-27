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

    console.log(`收到請求: type=${type}, stock_id=${stockId}`);

    // === 結構化財務數據查詢 ===
    if (type === 'financials' && stockId) {
        return await getStructuredFinancials(stockId, headers);
    }

    // === 原有邏輯：獲取原始數據 ===
    const sources = {
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh',
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd',
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins'
        ],
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L'
        ],
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'
        ],
        stocks: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
        ],
        balance: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci',
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_fh',
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_bd',
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ins'
        ]
    };

    const targetUrls = sources[type];
    if (!targetUrls) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    try {
        const requests = targetUrls.map(url => fetch(url).then(res => {
            if (!res.ok) return [];
            return res.json().catch(() => []);
        }).catch(() => []));
        
        const results = await Promise.all(requests);
        const combinedData = results.flat().filter(item => item && (item['公司代號'] || item['公司代碼']));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(combinedData),
        };
    } catch (error) {
        console.error('原始數據獲取錯誤:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};

// === 核心：結構化財務數據處理 ===
async function getStructuredFinancials(stockId, headers) {
    try {
        console.log(`開始獲取股票 ${stockId} 的結構化財務數據`);

        // 1. 並行抓取所有需要的數據源
        const [incomeRes, balanceRes, revenueRes, ratioRes] = await Promise.all([
            // 綜合損益表（包含 EPS、淨利）
            Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins')
            ]).then(responses => Promise.all(responses.map(r => r.ok ? r.json() : []))),
            
            // 資產負債表（包含股東權益）
            Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_fh'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_bd'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ins')
            ]).then(responses => Promise.all(responses.map(r => r.ok ? r.json() : []))),

            // 月營收數據
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L').then(r => r.ok ? r.json() : []),
            
            // 財務比率（包含毛利率）
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap11_L').then(r => r.ok ? r.json() : [])
        ]);

        const allIncomeData = incomeRes.flat().filter(item => item['公司代號'] === stockId);
        const allBalanceData = balanceRes.flat().filter(item => item['公司代號'] === stockId);
        const allRevenueData = revenueRes.filter(item => item['公司代號'] === stockId);
        const allRatioData = ratioRes.filter(item => item['公司代號'] === stockId);

        const structuredData = parseFinancialData(allIncomeData, allBalanceData, allRevenueData, allRatioData);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(structuredData),
        };

    } catch (error) {
        console.error('getStructuredFinancials 錯誤:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
}


// === 核心：解析財務數據 (已修改邏輯) ===
function parseFinancialData(incomeData, balanceData, revenueData, ratioData) {
    const result = {
        eps: { quarters: {}, year: null, ttm: null }, // 加上 ttm
        roe: { quarters: {}, year: null },
        revenueGrowth: { months: {}, quarters: {}, year: null },
        profitMargin: { quarters: {}, year: null },
        _debug: { incomeCount: incomeData.length, balanceCount: balanceData.length, revenueCount: revenueData.length, ratioCount: ratioData.length }
    };

    // Helper: 轉換民國年/季別為 YYYYQQ 格式
    const getPeriodKey = (rocYear, quarter) => {
        if (!rocYear || !quarter || quarter === '0') return null;
        // 確保 rocYear 是字串且有足夠長度
        if (typeof rocYear !== 'string' || rocYear.length < 2) return null;
        const westYear = parseInt(rocYear) + 1911;
        return `${westYear}Q${quarter}`;
    };

    // === 解析 EPS ===
    incomeData.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        const epsRaw = row['基本每股盈餘（元）'];
        if (!epsRaw || epsRaw === '') return;
        const eps = parseFloat(String(epsRaw).replace(/,/g, ''));
        if (isNaN(eps)) return;

        if (quarter && quarter !== '0') {
            const periodKey = getPeriodKey(year, quarter);
            if (periodKey) result.eps.quarters[periodKey] = eps;
        } else if (quarter === '0') {
            result.eps.year = eps; // 單一年報數據
        }
    });
    
    // 計算 TTM EPS (最近四季總和)
    const sortedEpsQuarters = Object.keys(result.eps.quarters).sort().reverse();
    if (sortedEpsQuarters.length >= 4) {
        const ttmEps = sortedEpsQuarters.slice(0, 4).reduce((sum, key) => sum + result.eps.quarters[key], 0);
        result.eps.ttm = parseFloat(ttmEps.toFixed(2));
    }


    // === 解析 ROE (計算：淨利 / 股東權益) ===
    const equityData = {};
    balanceData.forEach(row => {
        const periodKey = getPeriodKey(row['年度'], row['季別']);
        // 股東權益總額
        let equityRaw = row['權益總額'] || row['歸屬於母公司業主之權益總額'] || row['資產總額'] - row['負債總額'];
        if (periodKey && equityRaw && equityRaw !== '') {
            const equity = parseFloat(String(equityRaw).replace(/,/g, ''));
            if (equity > 0) equityData[periodKey] = equity;
        }
    });

    incomeData.forEach(incomeRow => {
        const periodKey = getPeriodKey(incomeRow['年度'], incomeRow['季別']);
        if (!periodKey) return;
        
        // 優先使用「歸屬於母公司業主」的淨利
        let netIncomeRaw = incomeRow['淨利（淨損）歸屬於母公司業主'] || incomeRow['本期淨利（淨損）'];
        if (!netIncomeRaw || netIncomeRaw === '') return;
        const netIncome = parseFloat(String(netIncomeRaw).replace(/,/g, ''));
        if (isNaN(netIncome)) return;

        // ROE = (本期淨利 / 期末股東權益) * 100
        if (equityData[periodKey] && equityData[periodKey] !== 0) {
            const roe = (netIncome / equityData[periodKey]) * 100;
            result.roe.quarters[periodKey] = parseFloat(roe.toFixed(2));
        } else if (incomeRow['季別'] === '0') {
            // 保留年度 ROE 的邏輯
            result.roe.year = incomeRow['股東權益報酬率'] ? parseFloat(String(incomeRow['股東權益報酬率']).replace(/,/g, '')) : null;
        }
    });

    // === 解析毛利率 (從 ratioData 取得) ===
    ratioData.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        const marginRaw = row['毛利率(%)']; // 假設 API 直接提供
        if (!marginRaw || marginRaw === '') return;

        const margin = parseFloat(String(marginRaw).replace(/,/g, ''));
        if (isNaN(margin)) return;

        const periodKey = getPeriodKey(year, quarter);
        if (periodKey) {
            result.profitMargin.quarters[periodKey] = parseFloat(margin.toFixed(2));
        } else if (quarter === '0') {
            result.profitMargin.year = parseFloat(margin.toFixed(2));
        }
    });

    // === 解析營收成長率 (新增 MoM & QoQ 計算) ===
    if (revenueData.length > 0) {
        const revenueByYearMonth = {}; // YYYYMM -> Revenue
        const byYear = {}; // YYYY -> { MM: Revenue }
        
        // 1. 整理月營收數據
        revenueData.forEach(row => {
            const yearMonth = row['資料年月']; // 格式: "11411" (民國年YYYYMM)
            if (!yearMonth) return;
            const rocYear = yearMonth.substring(0, yearMonth.length - 2);
            const month = yearMonth.substring(yearMonth.length - 2);
            const westYear = parseInt(rocYear) + 1911;
            const key = `${westYear}${month}`;
            
            const revenueRaw = row['營業收入-當月營收'];
            if (!revenueRaw || revenueRaw === '') return;
            const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
            if (isNaN(revenue)) return;

            revenueByYearMonth[key] = revenue;

            if (!byYear[westYear]) byYear[westYear] = {};
            // 月份轉為數字，確保排序正確
            byYear[westYear][parseInt(month)] = revenue;
        });

        const sortedMonths = Object.keys(revenueByYearMonth).sort();

        // 2. 計算最新 MoM 增率 (月與上個月比較)
        if (sortedMonths.length >= 2) {
            const latestKey = sortedMonths.at(-1);
            const previousKey = sortedMonths.at(-2);
            const latestRevenue = revenueByYearMonth[latestKey];
            const previousRevenue = revenueByYearMonth[previousKey];
            
            if (previousRevenue > 0) {
                const momGrowth = (latestRevenue - previousRevenue) / previousRevenue * 100;
                result.revenueGrowth.months.latestMoM = parseFloat(momGrowth.toFixed(2));
            }
        }
        
        // 3. 計算各季度總營收
        const quarterRevenues = {};
        const years = Object.keys(byYear).sort();
        years.forEach(year => {
            const months = byYear[year];
            // 季度營收加總
            quarterRevenues[`${year}Q1`] = (months[1] || 0) + (months[2] || 0) + (months[3] || 0);
            quarterRevenues[`${year}Q2`] = (months[4] || 0) + (months[5] || 0) + (months[6] || 0);
            quarterRevenues[`${year}Q3`] = (months[7] || 0) + (months[8] || 0) + (months[9] || 0);
            quarterRevenues[`${year}Q4`] = (months[10] || 0) + (months[11] || 0) + (months[12] || 0);
        });

        // 4. 計算最新 QoQ 增率 (季與上季比較)
        const sortedQuarterKeys = Object.keys(quarterRevenues).filter(key => quarterRevenues[key] > 0).sort();

        if (sortedQuarterKeys.length >= 2) {
            const latestQuarterKey = sortedQuarterKeys.at(-1);
            const prevQuarterKey = sortedQuarterKeys.at(-2);
            const latestRevenue = quarterRevenues[latestQuarterKey];
            const prevRevenue = quarterRevenues[prevQuarterKey];
            
            if (prevRevenue > 0) {
                const qoqGrowth = (latestRevenue - prevRevenue) / prevRevenue * 100;
                result.revenueGrowth.quarters.latestQoQ = parseFloat(qoqGrowth.toFixed(2));
            }
        }
        
        // 保留原有的年營收成長邏輯 (如果 API 提供年增率數據，可以填入 result.revenueGrowth.year)
    }

    return { ...result };
}