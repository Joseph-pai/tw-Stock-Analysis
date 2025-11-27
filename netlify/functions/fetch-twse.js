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

        // 季別 "0" 代表年度，"1"~"4" 代表各季度
        if (quarter && quarter !== '0') {
            result.eps.quarters[`${year}Q${quarter}`] = eps;
        } else if (quarter === '0') {
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
            let equityRaw = balanceRow['權益總額'] || 
                           balanceRow['歸屬於母公司業主之權益合計'];
            
            if (!equityRaw || equityRaw === '') return;
            
            const equity = parseFloat(String(equityRaw).replace(/,/g, ''));

            if (!isNaN(equity) && equity !== 0) {
                const roe = (netIncome / equity) * 100;

                if (quarter && quarter !== '0') {
                    result.roe.quarters[`${year}Q${quarter}`] = parseFloat(roe.toFixed(2));
                } else if (quarter === '0') {
                    result.roe.year = parseFloat(roe.toFixed(2));
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
        const year = row['年度'];
        const quarter = row['季別'];
        const marginRaw = row['毛利率(%)(營業毛利)/(營業收入)'];
        
        if (!marginRaw || marginRaw === '') return;
        
        const margin = parseFloat(String(marginRaw).replace(/,/g, ''));
        if (isNaN(margin)) return;

        if (quarter && quarter !== '0') {
            result.profitMargin.quarters[`${year}Q${quarter}`] = margin;
        } else if (quarter === '0') {
            result.profitMargin.year = margin;
        }
    });

    // 如果 t187ap17_L 沒有毛利率，從損益表計算
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

            if (quarter && quarter !== '0') {
                result.profitMargin.quarters[`${year}Q${quarter}`] = parseFloat(margin.toFixed(2));
            } else if (quarter === '0') {
                result.profitMargin.year = parseFloat(margin.toFixed(2));
            }
        });
    }

    // === 計算年度毛利率 (最新年度值) ===
    const currentYear = Math.max(...Object.keys(result.profitMargin.quarters)
        .map(key => parseInt(key.substring(0, 4))));
    const currentYearMargins = Object.entries(result.profitMargin.quarters)
        .filter(([key]) => key.startsWith(currentYear))
        .map(([_, value]) => value);
    
    if (currentYearMargins.length > 0 && !result.profitMargin.year) {
        // 使用最新年度的最新季度值作為年度參考值
        result.profitMargin.year = currentYearMargins[currentYearMargins.length - 1];
    }

    // === 解析營收成長率 ===
    if (revenueData.length > 0) {
        // 月營收增率 - 直接從 API 取得月增率
        revenueData.forEach(row => {
            const yearMonth = row['資料年月']; // 格式: "11411" (民國年YYYYMM)
            const monthGrowthRaw = row['營業收入-去年同月增減(%)'];
            
            if (!yearMonth || !monthGrowthRaw || monthGrowthRaw === '') return;
            
            const monthGrowth = parseFloat(String(monthGrowthRaw).replace(/,/g, ''));
            if (!isNaN(monthGrowth)) {
                result.revenueGrowth.months[yearMonth] = monthGrowth;
            }
        });

        // 計算月營收月增率 (本月 vs 上月)
        result.revenueGrowth.monthOverMonth = calculateMonthOverMonthGrowth(revenueData);

        // 計算季營收成長率 (本季 vs 上季)
        result.revenueGrowth.quarters = calculateQuarterOverQuarterGrowth(revenueData);

        // 年營收增率 - 使用「累計營收增減率」
        const sortedRevenue = [...revenueData].sort((a, b) => 
            (b['資料年月'] || '').localeCompare(a['資料年月'] || '')
        );
        
        if (sortedRevenue.length > 0) {
            const latestYearGrowthRaw = sortedRevenue[0]['累計營業收入-前期比較增減(%)'];
            if (latestYearGrowthRaw && latestYearGrowthRaw !== '') {
                const latestYearGrowth = parseFloat(String(latestYearGrowthRaw).replace(/,/g, ''));
                if (!isNaN(latestYearGrowth)) {
                    result.revenueGrowth.year = latestYearGrowth;
                }
            }
        }
    }

    return result;
}

// === 計算月營收月增率 ===
function calculateMonthOverMonthGrowth(revenueData) {
    const growthRates = {};
    
    // 按年月排序 (新到舊)
    const sortedData = [...revenueData].sort((a, b) => 
        (b['資料年月'] || '').localeCompare(a['資料年月'] || '')
    );

    for (let i = 0; i < sortedData.length - 1; i++) {
        const current = sortedData[i];
        const previous = sortedData[i + 1];
        
        const currentYM = current['資料年月'];
        const currentRevenue = parseFloat(String(current['營業收入-當月營收']).replace(/,/g, ''));
        const previousRevenue = parseFloat(String(previous['營業收入-當月營收']).replace(/,/g, ''));
        
        if (currentYM && !isNaN(currentRevenue) && !isNaN(previousRevenue) && previousRevenue !== 0) {
            const growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
            growthRates[currentYM] = parseFloat(growth.toFixed(2));
        }
    }
    
    return growthRates;
}

// === 計算季度營收季增率 ===
function calculateQuarterOverQuarterGrowth(revenueData) {
    const growthRates = {};
    const byYearQuarter = {};

    // 按年月分組（資料年月是民國年格式，如 "11411" = 民國114年11月）
    revenueData.forEach(row => {
        const ym = row['資料年月'];
        if (!ym || ym.length < 5) return;

        // 民國年格式：前3碼是年份，後2碼是月份
        const rocYear = ym.substring(0, 3); // 民國年：如 "114"
        const month = parseInt(ym.substring(3, 5)); // 月份：如 "11"
        const westYear = (parseInt(rocYear) + 1911).toString(); // 轉西元年：2025
        
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

    // 計算季增率
    const quarters = Object.keys(byYearQuarter).sort();
    
    for (let i = 1; i < quarters.length; i++) {
        const currentQuarter = quarters[i];
        const previousQuarter = quarters[i - 1];
        
        const currentRevenue = byYearQuarter[currentQuarter];
        const previousRevenue = byYearQuarter[previousQuarter];
        
        if (previousRevenue !== 0) {
            const growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
            growthRates[currentQuarter] = parseFloat(growth.toFixed(2));
        }
    }

    return growthRates;
}
[file content end]