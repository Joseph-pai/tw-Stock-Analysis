[file name]: fetch-twse.js
[file content begin]
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
            
            // 月營收（包含月/年營收增率）
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L')
                .then(r => r.ok ? r.json() : [])
                .catch(() => []),
            
            // 營益分析（包含毛利率）
            fetch('https://openapi.twse.com.tw/v1/opendata/t187ap17_L')
                .then(r => r.ok ? r.json() : [])
                .catch(() => [])
        ]);

        // 2. 合併並過濾該股票的數據
        const allIncome = incomeRes.flat().filter(row => row['公司代號'] === stockId);
        const allBalance = balanceRes.flat().filter(row => row['公司代號'] === stockId);
        const allRevenue = Array.isArray(revenueRes) ? revenueRes.filter(row => 
            row['公司代號'] === stockId
        ) : [];
        const allRatio = Array.isArray(ratioRes) ? ratioRes.filter(row => 
            row['公司代號'] === stockId
        ) : [];

        console.log(`找到數據: 損益表 ${allIncome.length}, 資產負債表 ${allBalance.length}, 月營收 ${allRevenue.length}, 營益分析 ${allRatio.length}`);

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

// === 民國年轉換函數 ===
function convertRocToWestYear(rocYear) {
    // 處理字串或數字格式的民國年
    const rocNum = parseInt(rocYear.toString());
    if (isNaN(rocNum)) return null;
    return rocNum + 1911;
}

function convertRocYearMonth(rocYearMonth) {
    // 處理 "11411" 格式的民國年月
    if (!rocYearMonth || rocYearMonth.length < 5) return null;
    const rocYear = parseInt(rocYearMonth.substring(0, 3));
    const month = rocYearMonth.substring(3, 5);
    const westYear = rocYear + 1911;
    return {
        westYear: westYear.toString(),
        month: month,
        westYearMonth: `${westYear}${month}`
    };
}

// === 核心：數據解析函數 ===
function parseFinancialData(incomeData, balanceData, revenueData, ratioData) {
    const result = {
        eps: { quarters: {}, year: null },
        roe: { quarters: {}, year: null },
        revenueGrowth: { 
            monthOverMonth: {},  // 月增率
            yearOverYear: {},    // 年增率  
            quarters: {},        // 季增率
            cumulative: null     // 累計年增率
        },
        profitMargin: { quarters: {}, year: null },
        _debug: {
            incomeCount: incomeData.length,
            balanceCount: balanceData.length,
            revenueCount: revenueData.length,
            ratioCount: ratioData.length,
            incomeYears: [],
            balanceYears: [],
            revenueMonths: [],
            ratioYears: []
        }
    };

    // === 解析 EPS ===
    incomeData.forEach(row => {
        const rocYear = row['年度'];
        const quarter = row['季別'];
        const epsRaw = row['基本每股盈餘（元）'];
        
        if (!epsRaw || epsRaw === '' || !rocYear) return;
        
        const eps = parseFloat(String(epsRaw).replace(/,/g, ''));
        if (isNaN(eps)) return;

        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) return;

        result._debug.incomeYears.push(`${rocYear}->${westYear}Q${quarter}`);

        // 季別 "0" 代表年度，"1"~"4" 代表各季度
        if (quarter && quarter !== '0') {
            result.eps.quarters[`${westYear}Q${quarter}`] = eps;
        } else if (quarter === '0') {
            result.eps.year = eps;
        }
    });

    // === 解析 ROE (計算：淨利 / 股東權益) ===
    incomeData.forEach(incomeRow => {
        const rocYear = incomeRow['年度'];
        const quarter = incomeRow['季別'];
        
        if (!rocYear) return;

        // 優先使用「歸屬於母公司業主」的淨利
        let netIncomeRaw = incomeRow['淨利（淨損）歸屬於母公司業主'] || 
                          incomeRow['本期淨利（淨損）'];
        
        if (!netIncomeRaw || netIncomeRaw === '') return;
        
        const netIncome = parseFloat(String(netIncomeRaw).replace(/,/g, ''));
        if (isNaN(netIncome)) return;

        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) return;

        // 找到對應期間的股東權益
        const balanceRow = balanceData.find(b => 
            b['年度'] === rocYear && b['季別'] === quarter
        );

        if (balanceRow) {
            let equityRaw = balanceRow['權益總額'] || 
                           balanceRow['歸屬於母公司業主之權益合計'];
            
            if (!equityRaw || equityRaw === '') return;
            
            const equity = parseFloat(String(equityRaw).replace(/,/g, ''));

            if (!isNaN(equity) && equity !== 0) {
                const roe = (netIncome / equity) * 100;
                const roeValue = parseFloat(roe.toFixed(2));

                if (quarter && quarter !== '0') {
                    result.roe.quarters[`${westYear}Q${quarter}`] = roeValue;
                } else if (quarter === '0') {
                    result.roe.year = roeValue;
                }
            }
        }
    });

    // === 計算年度ROE (季度平均值) ===
    const quarterROEs = Object.values(result.roe.quarters).filter(val => !isNaN(val));
    if (quarterROEs.length > 0) {
        const avgROE = quarterROEs.reduce((sum, val) => sum + val, 0) / quarterROEs.length;
        result.roe.year = parseFloat(avgROE.toFixed(2));
    }

    // === 解析毛利率（直接從 t187ap17_L 取得）===
    ratioData.forEach(row => {
        const rocYear = row['年度'];
        const quarter = row['季別'];
        const marginRaw = row['毛利率(%)(營業毛利)/(營業收入)'];
        
        if (!marginRaw || marginRaw === '' || !rocYear) return;
        
        const margin = parseFloat(String(marginRaw).replace(/,/g, ''));
        if (isNaN(margin)) return;

        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) return;

        result._debug.ratioYears.push(`${rocYear}->${westYear}Q${quarter}`);

        if (quarter && quarter !== '0') {
            result.profitMargin.quarters[`${westYear}Q${quarter}`] = margin;
        } else if (quarter === '0') {
            result.profitMargin.year = margin;
        }
    });

    // 如果 t187ap17_L 沒有毛利率，從損益表計算
    if (Object.keys(result.profitMargin.quarters).length === 0 && !result.profitMargin.year) {
        incomeData.forEach(row => {
            const rocYear = row['年度'];
            const quarter = row['季別'];
            
            if (!rocYear) return;

            const revenueRaw = row['營業收入'];
            const grossProfitRaw = row['營業毛利（毛損）淨額'] || row['營業毛利（毛損）'];
            
            if (!revenueRaw || !grossProfitRaw) return;
            
            const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
            const grossProfit = parseFloat(String(grossProfitRaw).replace(/,/g, ''));
            
            if (isNaN(revenue) || isNaN(grossProfit) || revenue === 0) return;
            
            const margin = (grossProfit / revenue) * 100;
            const westYear = convertRocToWestYear(rocYear);
            if (!westYear) return;

            if (quarter && quarter !== '0') {
                result.profitMargin.quarters[`${westYear}Q${quarter}`] = parseFloat(margin.toFixed(2));
            } else if (quarter === '0') {
                result.profitMargin.year = parseFloat(margin.toFixed(2));
            }
        });
    }

    // === 計算年度毛利率 (最新年度值) ===
    const currentYearKeys = Object.keys(result.profitMargin.quarters)
        .filter(key => key.match(/^\d{4}Q[1-4]$/))
        .map(key => parseInt(key.substring(0, 4)));
    
    if (currentYearKeys.length > 0 && !result.profitMargin.year) {
        const currentYear = Math.max(...currentYearKeys);
        const currentYearMargins = Object.entries(result.profitMargin.quarters)
            .filter(([key]) => key.startsWith(currentYear.toString()))
            .map(([_, value]) => value);
        
        if (currentYearMargins.length > 0) {
            // 使用最新年度的最新季度值作為年度參考值
            result.profitMargin.year = currentYearMargins[currentYearMargins.length - 1];
        }
    }

    // === 解析營收成長率 ===
    if (revenueData.length > 0) {
        revenueData.forEach(row => {
            const rocYearMonth = row['資料年月'];
            const monthGrowthRaw = row['營業收入-上月比較增減(%)']; // 月增率
            const yearGrowthRaw = row['營業收入-去年同月增減(%)'];  // 年增率
            const cumulativeGrowthRaw = row['累計營業收入-前期比較增減(%)']; // 累計年增率
            
            if (!rocYearMonth) return;

            const converted = convertRocYearMonth(rocYearMonth);
            if (!converted) return;

            result._debug.revenueMonths.push(`${rocYearMonth}->${converted.westYearMonth}`);

            // 月增率
            if (monthGrowthRaw && monthGrowthRaw !== '') {
                const monthGrowth = parseFloat(String(monthGrowthRaw).replace(/,/g, ''));
                if (!isNaN(monthGrowth)) {
                    result.revenueGrowth.monthOverMonth[converted.westYearMonth] = monthGrowth;
                }
            }

            // 年增率
            if (yearGrowthRaw && yearGrowthRaw !== '') {
                const yearGrowth = parseFloat(String(yearGrowthRaw).replace(/,/g, ''));
                if (!isNaN(yearGrowth)) {
                    result.revenueGrowth.yearOverYear[converted.westYearMonth] = yearGrowth;
                }
            }

            // 累計年增率 (取最新的)
            if (cumulativeGrowthRaw && cumulativeGrowthRaw !== '' && !result.revenueGrowth.cumulative) {
                const cumulativeGrowth = parseFloat(String(cumulativeGrowthRaw).replace(/,/g, ''));
                if (!isNaN(cumulativeGrowth)) {
                    result.revenueGrowth.cumulative = cumulativeGrowth;
                }
            }
        });

        // 計算季營收成長率
        result.revenueGrowth.quarters = calculateQuarterlyGrowth(revenueData);
    }

    // 清理調試信息中的重複項
    result._debug.incomeYears = [...new Set(result._debug.incomeYears)];
    result._debug.balanceYears = [...new Set(result._debug.balanceYears)];
    result._debug.revenueMonths = [...new Set(result._debug.revenueMonths)];
    result._debug.ratioYears = [...new Set(result._debug.ratioYears)];

    console.log('解析完成結果:', {
        eps: result.eps,
        roe: result.roe,
        revenueGrowth: {
            monthOverMonth: Object.keys(result.revenueGrowth.monthOverMonth).length,
            yearOverYear: Object.keys(result.revenueGrowth.yearOverYear).length,
            quarters: Object.keys(result.revenueGrowth.quarters).length,
            cumulative: result.revenueGrowth.cumulative
        },
        profitMargin: result.profitMargin,
        debug: result._debug
    });

    return result;
}

// === 計算季度營收成長率 ===
function calculateQuarterlyGrowth(revenueData) {
    const growthRates = {};
    const byYearQuarter = {};

    // 按年月分組（資料年月是民國年格式）
    revenueData.forEach(row => {
        const rocYearMonth = row['資料年月'];
        if (!rocYearMonth || rocYearMonth.length < 5) return;

        const converted = convertRocYearMonth(rocYearMonth);
        if (!converted) return;

        const month = parseInt(converted.month);
        const westYear = converted.westYear;
        
        const revenueRaw = row['營業收入-當月營收'];
        
        if (!revenueRaw || revenueRaw === '') return;
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        if (isNaN(revenue)) return;

        // 確定季度
        let quarter;
        if (month >= 1 && month <= 3) quarter = 'Q1';
        else if (month >= 4 && month <= 6) quarter = 'Q2';
        else if (month >= 7 && month <= 9) quarter = 'Q3';
        else if (month >= 10 && month <= 12) quarter = 'Q4';
        else return;

        const key = `${westYear}${quarter}`;
        if (!byYearQuarter[key]) byYearQuarter[key] = 0;
        byYearQuarter[key] += revenue;
    });

    // 計算季增率 (本季 vs 上季)
    const quarters = Object.keys(byYearQuarter).sort();
    
    for (let i = 1; i < quarters.length; i++) {
        const currentQuarter = quarters[i];
        const previousQuarter = quarters[i - 1];
        
        // 確保是相鄰季度 (同一年或相鄰年)
        const currentYear = parseInt(currentQuarter.substring(0, 4));
        const prevYear = parseInt(previousQuarter.substring(0, 4));
        const currentQ = currentQuarter.substring(4);
        const prevQ = previousQuarter.substring(4);
        
        // 檢查是否為相鄰季度 (Q1->Q2, Q2->Q3, Q3->Q4, Q4->Q1[隔年])
        const isConsecutive = 
            (currentYear === prevYear && 
             ((prevQ === 'Q1' && currentQ === 'Q2') ||
              (prevQ === 'Q2' && currentQ === 'Q3') ||
              (prevQ === 'Q3' && currentQ === 'Q4'))) ||
            (currentYear === prevYear + 1 && prevQ === 'Q4' && currentQ === 'Q1');
        
        if (isConsecutive) {
            const currentRevenue = byYearQuarter[currentQuarter];
            const previousRevenue = byYearQuarter[previousQuarter];
            
            if (previousRevenue !== 0) {
                const growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
                growthRates[currentQuarter] = parseFloat(growth.toFixed(2));
            }
        }
    }

    return growthRates;
}
[file content end]