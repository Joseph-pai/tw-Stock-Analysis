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
        const allIncome = incomeRes.flat().filter(row => row && row['公司代號'] === stockId);
        const allBalance = balanceRes.flat().filter(row => row && row['公司代號'] === stockId);
        const allRevenue = Array.isArray(revenueRes) ? revenueRes.filter(row => row && row['公司代號'] === stockId) : [];
        const allRatio = Array.isArray(ratioRes) ? ratioRes.filter(row => row && row['公司代號'] === stockId) : [];

        console.log(`找到數據: 損益表 ${allIncome.length}, 資產負債表 ${allBalance.length}, 月營收 ${allRevenue.length}, 營益分析 ${allRatio.length}`);

        // 3. 如果數據不足，嘗試從其他來源補充
        if (allIncome.length === 0 || allBalance.length === 0 || allRevenue.length === 0) {
            console.log('數據不足，嘗試補充數據...');
            
            // 補充季度數據
            try {
                const quarterlyResponse = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci');
                if (quarterlyResponse.ok) {
                    const quarterlyData = await quarterlyResponse.json();
                    const additionalIncome = Array.isArray(quarterlyData) ? quarterlyData.filter(row => row && row['公司代號'] === stockId) : [];
                    allIncome.push(...additionalIncome);
                    console.log(`補充損益表數據: ${additionalIncome.length} 筆`);
                }
            } catch (e) {
                console.log('補充季度數據失敗:', e.message);
            }

            // 補充月營收數據
            try {
                const monthlyResponse = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L');
                if (monthlyResponse.ok) {
                    const monthlyData = await monthlyResponse.json();
                    const additionalRevenue = Array.isArray(monthlyData) ? monthlyData.filter(row => row && row['公司代號'] === stockId) : [];
                    allRevenue.push(...additionalRevenue);
                    console.log(`補充月營收數據: ${additionalRevenue.length} 筆`);
                }
            } catch (e) {
                console.log('補充月營收數據失敗:', e.message);
            }
        }

        // 4. 解析並結構化數據（所有民國年都會轉換為西元年）
        const result = parseFinancialData(allIncome, allBalance, allRevenue, allRatio);

        // 5. 添加原始數據到結果中，供前端人工計算使用
        result.rawData = {
            incomeStatements: allIncome,
            balanceSheets: allBalance,
            monthlyRevenues: allRevenue,
            financialRatios: allRatio
        };

        // 6. 添加數據完整性報告
        result.dataCompleteness = {
            incomeStatements: allIncome.length,
            balanceSheets: allBalance.length,
            monthlyRevenues: allRevenue.length,
            financialRatios: allRatio.length,
            hasEPS: allIncome.some(income => income['基本每股盈餘（元）'] && income['基本每股盈餘（元）'] !== ''),
            hasNetIncome: allIncome.some(income => income['淨利（淨損）歸屬於母公司業主'] && income['淨利（淨損）歸屬於母公司業主'] !== ''),
            hasRevenue: allRevenue.length > 0,
            hasGrowthRates: allRevenue.some(rev => (rev['營業收入-上月比較增減(%)'] && rev['營業收入-上月比較增減(%)'] !== '') || 
                                                  (rev['營業收入-去年同月增減(%)'] && rev['營業收入-去年同月增減(%)'] !== ''))
        };

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
    if (!rocYear) return null;
    
    const rocStr = rocYear.toString().trim();
    
    // 處理不同格式的民國年
    if (rocStr.length === 3) {
        // 完整民國年格式 "113" -> 轉換為 2024
        const rocNum = parseInt(rocStr);
        return isNaN(rocNum) ? null : rocNum + 1911;
    } else if (rocStr.length === 4 || rocStr.length === 5) {
        // 年月格式 "11311" 或年度格式 "1130" -> 提取民國年部分轉換
        const yearPart = rocStr.substring(0, 3);
        const rocNum = parseInt(yearPart);
        return isNaN(rocNum) ? null : rocNum + 1911;
    } else if (rocStr.length === 6) {
        // 完整年月格式 "1131101" -> 提取民國年部分轉換
        const yearPart = rocStr.substring(0, 3);
        const rocNum = parseInt(yearPart);
        return isNaN(rocNum) ? null : rocNum + 1911;
    } else if (rocStr.length === 1 || rocStr.length === 2) {
        // 可能只有年份部分，但這種情況較少見
        const rocNum = parseInt(rocStr);
        return isNaN(rocNum) ? null : rocNum + 1911;
    }
    
    console.log(`無法解析的民國年格式: ${rocYear}`);
    return null;
}

function convertRocYearMonth(rocYearMonth) {
    if (!rocYearMonth || typeof rocYearMonth !== 'string') return null;
    
    const cleanStr = rocYearMonth.toString().trim();
    
    // 處理不同長度的民國年月格式
    if (cleanStr.length === 5) {
        // 格式 "11311" (民國113年11月) -> 轉換為 "202411"
        const rocYear = parseInt(cleanStr.substring(0, 3));
        const month = cleanStr.substring(3, 5);
        
        if (isNaN(rocYear) || isNaN(parseInt(month))) {
            console.log(`無效的民國年月格式: ${rocYearMonth}`);
            return null;
        }
        
        const westYear = rocYear + 1911;
        return {
            westYear: westYear.toString(),
            month: month,
            westYearMonth: `${westYear}${month}`,
            display: `${westYear}-${month}`
        };
    } else if (cleanStr.length === 6) {
        // 格式 "1131101" (民國113年11月01日) -> 轉換為 "202411"
        const rocYear = parseInt(cleanStr.substring(0, 3));
        const month = cleanStr.substring(3, 5);
        
        if (isNaN(rocYear) || isNaN(parseInt(month))) {
            console.log(`無效的民國年月格式: ${rocYearMonth}`);
            return null;
        }
        
        const westYear = rocYear + 1911;
        return {
            westYear: westYear.toString(),
            month: month,
            westYearMonth: `${westYear}${month}`,
            display: `${westYear}-${month}`
        };
    } else if (cleanStr.length === 3) {
        // 只有民國年 "113" -> 轉換為 "2024" 並使用1月作為預設
        const rocYear = parseInt(cleanStr);
        if (isNaN(rocYear)) return null;
        
        const westYear = rocYear + 1911;
        return {
            westYear: westYear.toString(),
            month: '01',
            westYearMonth: `${westYear}01`,
            display: `${westYear}-01`
        };
    }
    
    console.log(`無法解析的民國年月格式: ${rocYearMonth}`);
    return null;
}

// === 數據解析函數（確保所有民國年都轉換為西元年）===
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

    console.log('開始解析財務數據（所有民國年將轉換為西元年）');

    // === 解析 EPS（民國年轉西元年）===
    console.log('開始解析 EPS 數據...');
    incomeData.forEach((row, index) => {
        if (!row) return;
        
        const rocYear = row['年度']; // 民國年
        const quarter = row['季別'];
        const epsRaw = row['基本每股盈餘（元）'];
        
        console.log(`EPS 數據 ${index}: 民國年度=${rocYear}, 季別=${quarter}, EPS原始值=${epsRaw}`);
        
        if (!epsRaw || epsRaw === '' || !rocYear || !quarter) {
            return;
        }
        
        const eps = parseFloat(String(epsRaw).replace(/,/g, ''));
        if (isNaN(eps)) return;

        // 民國年轉西元年
        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) {
            console.log(`EPS 數據 ${index}: 跳過 - 無法轉換民國年: ${rocYear}`);
            return;
        }

        console.log(`民國年 ${rocYear} 轉換為西元年 ${westYear}`);

        // 季度處理：使用西元年格式
        if (quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4') {
            const quarterKey = `${westYear}Q${quarter}`; // 西元年格式
            result.eps.quarters[quarterKey] = eps;
            result._debug.incomeYears.push(`${rocYear}->${westYear}Q${quarter}`);
            console.log(`✓ 設置季度 EPS: ${quarterKey} = ${eps}`);
        } else if (quarter === '0') {
            result.eps.year = eps;
            result._debug.incomeYears.push(`${rocYear}->${westYear}`);
            console.log(`✓ 設置年度 EPS: ${westYear} = ${eps}`);
        }
    });

    // === 解析 ROE（民國年轉西元年）===
    console.log('開始解析 ROE 數據...');
    incomeData.forEach((incomeRow, index) => {
        if (!incomeRow) return;
        
        const rocYear = incomeRow['年度']; // 民國年
        const quarter = incomeRow['季別'];
        
        if (!rocYear || !quarter) return;

        let netIncomeRaw = incomeRow['淨利（淨損）歸屬於母公司業主'] || 
                          incomeRow['本期淨利（淨損）'];
        
        if (!netIncomeRaw || netIncomeRaw === '') return;
        
        const netIncome = parseFloat(String(netIncomeRaw).replace(/,/g, ''));
        if (isNaN(netIncome)) return;

        // 民國年轉西元年
        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) return;

        // 找到對應期間的股東權益
        const balanceRow = balanceData.find(b => 
            b && b['年度'] === rocYear && b['季別'] === quarter
        );

        if (!balanceRow) return;

        let equityRaw = balanceRow['權益總額'] || 
                       balanceRow['歸屬於母公司業主之權益合計'];
        
        if (!equityRaw || equityRaw === '') return;
        
        const equity = parseFloat(String(equityRaw).replace(/,/g, ''));

        if (!isNaN(equity) && equity !== 0) {
            const roe = (netIncome / equity) * 100;
            const roeValue = parseFloat(roe.toFixed(2));

            // 使用西元年格式
            if (quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4') {
                const quarterKey = `${westYear}Q${quarter}`; // 西元年格式
                result.roe.quarters[quarterKey] = roeValue;
                result._debug.balanceYears.push(`${rocYear}->${westYear}Q${quarter}`);
                console.log(`✓ 設置季度 ROE: ${quarterKey} = ${roeValue}%`);
            } else if (quarter === '0') {
                result.roe.year = roeValue;
                result._debug.balanceYears.push(`${rocYear}->${westYear}`);
                console.log(`✓ 設置年度 ROE: ${westYear} = ${roeValue}%`);
            }
        }
    });

    // === 解析毛利率（民國年轉西元年）===
    console.log('開始解析毛利率數據...');
    
    ratioData.forEach((row, index) => {
        if (!row) return;
        
        const rocYear = row['年度']; // 民國年
        const quarter = row['季別'];
        const marginRaw = row['毛利率(%)(營業毛利)/(營業收入)'];
        
        if (!marginRaw || marginRaw === '' || !rocYear || !quarter) return;
        
        const margin = parseFloat(String(marginRaw).replace(/,/g, ''));
        if (isNaN(margin)) return;

        // 民國年轉西元年
        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) return;

        // 使用西元年格式
        if (quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4') {
            const quarterKey = `${westYear}Q${quarter}`; // 西元年格式
            result.profitMargin.quarters[quarterKey] = margin;
            result._debug.ratioYears.push(`${rocYear}->${westYear}Q${quarter}`);
            console.log(`✓ 設置季度毛利率: ${quarterKey} = ${margin}%`);
        } else if (quarter === '0') {
            result.profitMargin.year = margin;
            result._debug.ratioYears.push(`${rocYear}->${westYear}`);
            console.log(`✓ 設置年度毛利率: ${westYear} = ${margin}%`);
        }
    });

    // === 解析營收成長率（民國年月轉西元年月）===
    console.log('開始解析營收成長率數據...');
    if (revenueData.length > 0) {
        revenueData.forEach((row, index) => {
            if (!row) return;
            
            const rocYearMonth = row['資料年月']; // 民國年月
            const monthGrowthRaw = row['營業收入-上月比較增減(%)'];
            const yearGrowthRaw = row['營業收入-去年同月增減(%)'];
            const cumulativeGrowthRaw = row['累計營業收入-前期比較增減(%)'];
            
            if (!rocYearMonth) return;

            // 民國年月轉西元年月
            const converted = convertRocYearMonth(rocYearMonth);
            if (!converted) {
                console.log(`營收數據 ${index}: 跳過 - 無法轉換民國年月: ${rocYearMonth}`);
                return;
            }

            console.log(`民國年月 ${rocYearMonth} 轉換為西元年月 ${converted.westYearMonth}`);

            result._debug.revenueMonths.push(`${rocYearMonth}->${converted.westYearMonth}`);

            // 月增率（使用西元年月格式）
            if (monthGrowthRaw && monthGrowthRaw !== '') {
                const monthGrowth = parseFloat(String(monthGrowthRaw).replace(/,/g, ''));
                if (!isNaN(monthGrowth)) {
                    result.revenueGrowth.monthOverMonth[converted.westYearMonth] = monthGrowth;
                    console.log(`✓ 設置月增率: ${converted.display} = ${monthGrowth}%`);
                }
            }

            // 年增率（使用西元年月格式）
            if (yearGrowthRaw && yearGrowthRaw !== '') {
                const yearGrowth = parseFloat(String(yearGrowthRaw).replace(/,/g, ''));
                if (!isNaN(yearGrowth)) {
                    result.revenueGrowth.yearOverYear[converted.westYearMonth] = yearGrowth;
                    console.log(`✓ 設置年增率: ${converted.display} = ${yearGrowth}%`);
                }
            }

            // 累計年增率
            if (cumulativeGrowthRaw && cumulativeGrowthRaw !== '' && !result.revenueGrowth.cumulative) {
                const cumulativeGrowth = parseFloat(String(cumulativeGrowthRaw).replace(/,/g, ''));
                if (!isNaN(cumulativeGrowth)) {
                    result.revenueGrowth.cumulative = cumulativeGrowth;
                    console.log(`✓ 設置累計年增率: ${cumulativeGrowth}%`);
                }
            }
        });

        // 計算季營收成長率（使用西元年格式）
        console.log('開始計算季度營收成長率...');
        result.revenueGrowth.quarters = calculateQuarterlyGrowth(revenueData);
    }

    // 清理調試信息中的重複項
    result._debug.incomeYears = [...new Set(result._debug.incomeYears)];
    result._debug.balanceYears = [...new Set(result._debug.balanceYears)];
    result._debug.revenueMonths = [...new Set(result._debug.revenueMonths)];
    result._debug.ratioYears = [...new Set(result._debug.ratioYears)];

    console.log('解析完成結果（所有日期已轉換為西元年）:');
    console.log('- EPS 季度:', result.eps.quarters);
    console.log('- ROE 季度:', result.roe.quarters);
    console.log('- 毛利率季度:', result.profitMargin.quarters);

    return result;
}

// === 計算季度營收成長率（確保使用西元年格式）===
function calculateQuarterlyGrowth(revenueData) {
    const growthRates = {};
    const byYearQuarter = {};

    console.log('開始計算季度營收成長率（使用西元年格式）');

    // 按年月分組（民國年月轉西元年月）
    revenueData.forEach((row, index) => {
        if (!row) return;
        
        const rocYearMonth = row['資料年月']; // 民國年月
        if (!rocYearMonth || rocYearMonth.length < 5) return;

        // 民國年月轉西元年月
        const converted = convertRocYearMonth(rocYearMonth);
        if (!converted) return;

        const month = parseInt(converted.month);
        const westYear = converted.westYear; // 西元年
        
        const revenueRaw = row['營業收入-當月營收'];
        if (!revenueRaw || revenueRaw === '') return;
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        if (isNaN(revenue)) return;

        // 確定季度（使用西元年）
        let quarter;
        if (month >= 1 && month <= 3) quarter = 'Q1';
        else if (month >= 4 && month <= 6) quarter = 'Q2';
        else if (month >= 7 && month <= 9) quarter = 'Q3';
        else if (month >= 10 && month <= 12) quarter = 'Q4';
        else return;

        const key = `${westYear}${quarter}`; // 西元年格式
        if (!byYearQuarter[key]) byYearQuarter[key] = 0;
        byYearQuarter[key] += revenue;
    });

    // 計算季增率（使用西元年格式）
    const quarters = Object.keys(byYearQuarter).sort();
    
    for (let i = 1; i < quarters.length; i++) {
        const currentQuarter = quarters[i]; // 西元年格式
        const previousQuarter = quarters[i - 1]; // 西元年格式
        
        const currentYear = parseInt(currentQuarter.substring(0, 4));
        const prevYear = parseInt(previousQuarter.substring(0, 4));
        const currentQ = currentQuarter.substring(4);
        const prevQ = previousQuarter.substring(4);
        
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
                growthRates[currentQuarter] = parseFloat(growth.toFixed(2)); // 西元年格式
                console.log(`✓ 計算季增率: ${currentQuarter} = ${growthRates[currentQuarter]}%`);
            }
        }
    }

    return growthRates;
}