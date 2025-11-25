const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const type = event.queryStringParameters.type;
    const stockId = event.queryStringParameters.stock_id;

    // === 新增：結構化財務數據查詢 ===
    if (type === 'financials' && stockId) {
        return await getStructuredFinancials(stockId, headers);
    }

    // === 原有邏輯：獲取原始數據 ===
    const sources = {
        // 綜合損益表（季度+年度）- 包含 EPS, 毛利, 淨利
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',  // 一般業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh',  // 金融業
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd',  // 建材營造
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins', // 保險業
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'      // 累計營收（用於年營收成長率）
        ],
        // 財務比率（年度）- 包含毛利率等比率
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L',
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'
        ],
        // ✅ 修正：月營收表
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'  // 正確的月營收端點
        ],
        // 股票清單
        stocks: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
        ],
        // 資產負債表（用於計算 ROE）
        balance: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci',  // 一般業
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_fh',  // 金融業
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_bd',  // 建材營造
            'https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ins'  // 保險業
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
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};

// === 核心：結構化財務數據處理 ===
async function getStructuredFinancials(stockId, headers) {
    try {
        console.log(`開始獲取股票 ${stockId} 的結構化財務數據`);

        // 1. 並行抓取所有需要的數據源
        const [incomeRes, balanceRes, revenueRes, ratioRes] = await Promise.all([
            // 綜合損益表（EPS, 淨利）
            Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins')
            ]).then(responses => Promise.all(responses.map(r => r.ok ? r.json() : []))),
            
            // 資產負債表（股東權益）
            Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_fh'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_bd'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ins')
            ]).then(responses => Promise.all(responses.map(r => r.ok ? r.json() : []))),
            
            // 月營收（修正後的端點）
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L')
                .then(r => r.ok ? r.json() : [])
                .catch(() => []),
            
            // 財務比率（毛利率）
            Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap17_L'),
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap46_L')
            ]).then(responses => Promise.all(responses.map(r => r.ok ? r.json() : [])))
        ]);

        // 2. 合併並過濾該股票的數據
        const allIncome = incomeRes.flat().filter(row => row['公司代號'] === stockId);
        const allBalance = balanceRes.flat().filter(row => row['公司代號'] === stockId);
        const allRevenue = Array.isArray(revenueRes) ? revenueRes.filter(row => 
            row['公司代號'] === stockId || row['公司代碼'] === stockId
        ) : [];
        const allRatio = ratioRes.flat().filter(row => row['公司代號'] === stockId);

        console.log(`找到數據: 損益表 ${allIncome.length}, 資產負債表 ${allBalance.length}, 月營收 ${allRevenue.length}, 財務比率 ${allRatio.length}`);

        // 3. 解析並結構化數據
        const result = parseFinancialData(allIncome, allBalance, allRevenue, allRatio);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('getStructuredFinancials error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message, stack: error.stack })
        };
    }
}

// === 核心：數據解析函數 ===
function parseFinancialData(incomeData, balanceData, revenueData, ratioData) {
    const result = {
        eps: { quarters: {}, year: null },
        roe: { quarters: {}, year: null },
        revenueGrowth: { months: {}, quarters: {}, year: null },
        profitMargin: { quarters: {}, year: null },
        _debug: {
            incomeCount: incomeData.length,
            balanceCount: balanceData.length,
            revenueCount: revenueData.length,
            ratioCount: ratioData.length
        }
    };

    // === 解析 EPS ===
    incomeData.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        const epsRaw = row['基本每股盈餘（元）'];
        
        if (!epsRaw || epsRaw === '') return;
        
        const eps = parseFloat(String(epsRaw).replace(/,/g, ''));
        if (isNaN(eps)) return;

        if (quarter && quarter !== '00' && quarter !== '0') {
            // 季度數據：Q1, Q2, Q3, Q4
            result.eps.quarters[`Q${quarter}`] = eps;
        } else {
            // 年度數據（季別為 00 或空）
            result.eps.year = eps;
        }
    });

    // === 解析 ROE (計算：淨利 / 股東權益) ===
    incomeData.forEach(incomeRow => {
        const year = incomeRow['年度'];
        const quarter = incomeRow['季別'];
        
        // 優先使用「歸屬於母公司業主」的淨利
        let netIncomeRaw = incomeRow['淨利（淨損）歸屬於母公司業主'] || 
                          incomeRow['本期淨利（淨損）'];
        
        if (!netIncomeRaw || netIncomeRaw === '') return;
        
        const netIncome = parseFloat(String(netIncomeRaw).replace(/,/g, ''));
        if (isNaN(netIncome)) return;

        // 找到對應期間的股東權益
        const balanceRow = balanceData.find(b => 
            b['年度'] === year && b['季別'] === quarter
        );

        if (balanceRow) {
            let equityRaw = balanceRow['股東權益總額'] || 
                           balanceRow['權益總額'] ||
                           balanceRow['權益-歸屬於母公司業主'];
            
            if (!equityRaw || equityRaw === '') return;
            
            const equity = parseFloat(String(equityRaw).replace(/,/g, ''));

            if (!isNaN(equity) && equity !== 0) {
                const roe = (netIncome / equity) * 100;

                if (quarter && quarter !== '00' && quarter !== '0') {
                    result.roe.quarters[`Q${quarter}`] = parseFloat(roe.toFixed(2));
                } else {
                    result.roe.year = parseFloat(roe.toFixed(2));
                }
            }
        }
    });

    // === 解析毛利率 ===
    // 優先從財務比率 API 取得
    ratioData.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        const marginRaw = row['毛利率(%)(營業毛利)/(營業收入)'];
        
        if (!marginRaw || marginRaw === '') return;
        
        const margin = parseFloat(String(marginRaw).replace(/,/g, ''));
        if (isNaN(margin)) return;

        if (quarter && quarter !== '00' && quarter !== '0') {
            result.profitMargin.quarters[`Q${quarter}`] = margin;
        } else {
            result.profitMargin.year = margin;
        }
    });

    // 如果財務比率 API 沒有數據，從損益表計算
    if (Object.keys(result.profitMargin.quarters).length === 0 && !result.profitMargin.year) {
        incomeData.forEach(row => {
            const year = row['年度'];
            const quarter = row['季別'];
            
            const revenueRaw = row['營業收入'];
            const grossProfitRaw = row['營業毛利（毛損）淨額'] || row['營業毛利（毛損）'];
            
            if (!revenueRaw || !grossProfitRaw) return;
            
            const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
            const grossProfit = parseFloat(String(grossProfitRaw).replace(/,/g, ''));
            
            if (isNaN(revenue) || isNaN(grossProfit) || revenue === 0) return;
            
            const margin = (grossProfit / revenue) * 100;

            if (quarter && quarter !== '00' && quarter !== '0') {
                result.profitMargin.quarters[`Q${quarter}`] = parseFloat(margin.toFixed(2));
            } else {
                result.profitMargin.year = parseFloat(margin.toFixed(2));
            }
        });
    }

    // === 解析營收成長率 ===
    if (revenueData.length > 0) {
        // 月營收增率 - API 直接提供
        revenueData.forEach(row => {
            const yearMonth = row['資料年月'];
            const monthGrowthRaw = row['營業收入-去年同月增減(%)'];
            
            if (!yearMonth || !monthGrowthRaw || monthGrowthRaw === '') return;
            
            const monthGrowth = parseFloat(String(monthGrowthRaw).replace(/,/g, ''));
            if (!isNaN(monthGrowth)) {
                result.revenueGrowth.months[yearMonth] = monthGrowth;
            }
        });

        // 年營收增率 - 取最新月份的年累計增減率
        const sortedRevenue = [...revenueData].sort((a, b) => 
            (b['資料年月'] || '').localeCompare(a['資料年月'] || '')
        );
        
        if (sortedRevenue.length > 0) {
            const latestYearGrowthRaw = sortedRevenue[0]['營業收入-去年同月增減(%)'];
            if (latestYearGrowthRaw && latestYearGrowthRaw !== '') {
                const latestYearGrowth = parseFloat(String(latestYearGrowthRaw).replace(/,/g, ''));
                if (!isNaN(latestYearGrowth)) {
                    result.revenueGrowth.year = latestYearGrowth;
                }
            }
        }

        // 計算季營收成長率
        result.revenueGrowth.quarters = calculateQuarterlyGrowth(revenueData);
    }

    return result;
}

// === 計算季度營收成長率 ===
function calculateQuarterlyGrowth(revenueData) {
    const quarters = {};
    const byYear = {};

    // 按年月分組
    revenueData.forEach(row => {
        const ym = row['資料年月']; // "202401" 格式
        if (!ym || ym.length < 6) return;

        const year = ym.substring(0, 4);
        const month = parseInt(ym.substring(4, 6));
        const revenueRaw = row['營業收入'];
        
        if (!revenueRaw || revenueRaw === '') return;
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        if (isNaN(revenue)) return;

        if (!byYear[year]) byYear[year] = {};
        byYear[year][month] = revenue;
    });

    // 計算各季度總營收
    const quarterRevenues = {};
    const years = Object.keys(byYear).sort();

    years.forEach(year => {
        const months = byYear[year];
        quarterRevenues[`${year}Q1`] = (months[1] || 0) + (months[2] || 0) + (months[3] || 0);
        quarterRevenues[`${year}Q2`] = (months[4] || 0) + (months[5] || 0) + (months[6] || 0);
        quarterRevenues[`${year}Q3`] = (months[7] || 0) + (months[8] || 0) + (months[9] || 0);
        quarterRevenues[`${year}Q4`] = (months[10] || 0) + (months[11] || 0) + (months[12] || 0);
    });

    // 計算年增率
    const growthRates = {};
    years.forEach((year, idx) => {
        if (idx === 0) return; // 第一年沒有去年數據
        const prevYear = years[idx - 1];

        ['Q1', 'Q2', 'Q3', 'Q4'].forEach(q => {
            const current = quarterRevenues[`${year}${q}`];
            const previous = quarterRevenues[`${prevYear}${q}`];

            if (current && previous && previous !== 0) {
                const growth = ((current - previous) / previous) * 100;
                growthRates[q] = parseFloat(growth.toFixed(2));
            }
        });
    });

    return growthRates;
}