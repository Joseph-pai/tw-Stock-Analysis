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

        // 3. 解析並結構化數據
        const result = parseFinancialData(allIncome, allBalance, allRevenue, allRatio);

        // 4. 添加原始數據到結果中，供前端人工計算使用
        result.rawData = {
            incomeStatements: allIncome,
            balanceSheets: allBalance,
            monthlyRevenues: allRevenue,
            financialRatios: allRatio
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

// === 改進的民國年轉換函數 ===
function convertRocToWestYear(rocYear) {
    if (!rocYear) return null;
    
    const rocStr = rocYear.toString().trim();
    
    // 處理不同格式的民國年
    if (rocStr.length === 3) {
        // 完整民國年格式 "113"
        const rocNum = parseInt(rocStr);
        return isNaN(rocNum) ? null : rocNum + 1911;
    } else if (rocStr.length === 4 || rocStr.length === 5) {
        // 年月格式 "11311" 或年度格式 "1130"
        const yearPart = rocStr.substring(0, 3);
        const rocNum = parseInt(yearPart);
        return isNaN(rocNum) ? null : rocNum + 1911;
    } else if (rocStr.length === 6) {
        // 完整年月格式 "1131101"
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
        // 格式 "11311" (民國113年11月)
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
        // 格式 "1131101" (民國113年11月01日)
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
        // 只有民國年 "113"，使用當年1月作為預設
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

// === 改進的數據解析函數 ===
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
            ratioYears: [],
            rawSamples: {
                income: incomeData.slice(0, 2),
                balance: balanceData.slice(0, 2),
                revenue: revenueData.slice(0, 2),
                ratio: ratioData.slice(0, 2)
            }
        }
    };

    console.log('開始解析財務數據，樣本數據:', {
        incomeSample: incomeData[0],
        balanceSample: balanceData[0],
        revenueSample: revenueData[0],
        ratioSample: ratioData[0]
    });

    // === 解析 EPS ===
    console.log('開始解析 EPS 數據...');
    incomeData.forEach((row, index) => {
        if (!row) return;
        
        const rocYear = row['年度'];
        const quarter = row['季別'];
        const epsRaw = row['基本每股盈餘（元）'];
        
        console.log(`EPS 數據 ${index}: 年度=${rocYear}, 季別=${quarter}, EPS原始值=${epsRaw}`);
        
        if (!epsRaw || epsRaw === '' || !rocYear || !quarter) {
            console.log(`EPS 數據 ${index}: 跳過 - 缺少必要字段`);
            return;
        }
        
        const eps = parseFloat(String(epsRaw).replace(/,/g, ''));
        if (isNaN(eps)) {
            console.log(`EPS 數據 ${index}: 跳過 - 無法解析數值: ${epsRaw}`);
            return;
        }

        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) {
            console.log(`EPS 數據 ${index}: 跳過 - 無法轉換民國年: ${rocYear}`);
            return;
        }

        const debugInfo = `${rocYear}->${westYear}Q${quarter}`;
        result._debug.incomeYears.push(debugInfo);

        // 季度處理：'1'=Q1, '2'=Q2, '3'=Q3, '4'=Q4, '0'=年度
        if (quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4') {
            const quarterKey = `${westYear}Q${quarter}`;
            result.eps.quarters[quarterKey] = eps;
            console.log(`✓ 設置季度 EPS: ${quarterKey} = ${eps}`);
        } else if (quarter === '0') {
            result.eps.year = eps;
            console.log(`✓ 設置年度 EPS: ${westYear} = ${eps}`);
        } else {
            console.log(`EPS 數據 ${index}: 跳過 - 無效季度: ${quarter}`);
        }
    });

    // 如果沒有年度EPS，使用最新季度的平均值
    if (!result.eps.year && Object.keys(result.eps.quarters).length > 0) {
        const quarterValues = Object.values(result.eps.quarters);
        const avgEPS = quarterValues.reduce((sum, val) => sum + val, 0) / quarterValues.length;
        result.eps.year = parseFloat(avgEPS.toFixed(2));
        console.log(`使用季度平均值作為年度 EPS: ${result.eps.year}`);
    }

    // === 解析 ROE (計算：淨利 / 股東權益) ===
    console.log('開始解析 ROE 數據...');
    incomeData.forEach((incomeRow, index) => {
        if (!incomeRow) return;
        
        const rocYear = incomeRow['年度'];
        const quarter = incomeRow['季別'];
        
        if (!rocYear || !quarter) {
            console.log(`ROE 數據 ${index}: 跳過 - 缺少年度或季度`);
            return;
        }

        // 優先使用「歸屬於母公司業主」的淨利
        let netIncomeRaw = incomeRow['淨利（淨損）歸屬於母公司業主'] || 
                          incomeRow['本期淨利（淨損）'] ||
                          incomeRow['繼續營業單位本期淨利（淨損）'];
        
        console.log(`ROE 數據 ${index}: 年度=${rocYear}, 季度=${quarter}, 淨利原始值=${netIncomeRaw}`);
        
        if (!netIncomeRaw || netIncomeRaw === '') {
            console.log(`ROE 數據 ${index}: 跳過 - 無淨利數據`);
            return;
        }
        
        const netIncome = parseFloat(String(netIncomeRaw).replace(/,/g, ''));
        if (isNaN(netIncome)) {
            console.log(`ROE 數據 ${index}: 跳過 - 無法解析淨利: ${netIncomeRaw}`);
            return;
        }

        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) {
            console.log(`ROE 數據 ${index}: 跳過 - 無法轉換民國年: ${rocYear}`);
            return;
        }

        // 找到對應期間的股東權益
        const balanceRow = balanceData.find(b => 
            b && b['年度'] === rocYear && b['季別'] === quarter
        );

        if (!balanceRow) {
            console.log(`ROE 數據 ${index}: 跳過 - 找不到對應的資產負債表數據`);
            return;
        }

        let equityRaw = balanceRow['權益總額'] || 
                       balanceRow['歸屬於母公司業主之權益合計'] ||
                       balanceRow['股東權益總計'] ||
                       balanceRow['權益總計'];
        
        console.log(`ROE 數據 ${index}: 權益原始值=${equityRaw}`);
        
        if (!equityRaw || equityRaw === '') {
            console.log(`ROE 數據 ${index}: 跳過 - 無權益數據`);
            return;
        }
        
        const equity = parseFloat(String(equityRaw).replace(/,/g, ''));

        if (!isNaN(equity) && equity !== 0) {
            const roe = (netIncome / equity) * 100;
            const roeValue = parseFloat(roe.toFixed(2));

            if (quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4') {
                const quarterKey = `${westYear}Q${quarter}`;
                result.roe.quarters[quarterKey] = roeValue;
                console.log(`✓ 設置季度 ROE: ${quarterKey} = ${roeValue}%`);
            } else if (quarter === '0') {
                result.roe.year = roeValue;
                console.log(`✓ 設置年度 ROE: ${westYear} = ${roeValue}%`);
            }
        } else {
            console.log(`ROE 數據 ${index}: 跳過 - 權益為零或無效`);
        }
    });

    // 計算年度ROE (季度平均值)
    const quarterROEs = Object.values(result.roe.quarters).filter(val => !isNaN(val));
    if (quarterROEs.length > 0 && !result.roe.year) {
        const avgROE = quarterROEs.reduce((sum, val) => sum + val, 0) / quarterROEs.length;
        result.roe.year = parseFloat(avgROE.toFixed(2));
        console.log(`使用季度平均值作為年度 ROE: ${result.roe.year}%`);
    }

    // === 解析毛利率 ===
    console.log('開始解析毛利率數據...');
    
    // 先從營益分析表獲取
    ratioData.forEach((row, index) => {
        if (!row) return;
        
        const rocYear = row['年度'];
        const quarter = row['季別'];
        const marginRaw = row['毛利率(%)(營業毛利)/(營業收入)'];
        
        console.log(`毛利率數據 ${index}: 年度=${rocYear}, 季度=${quarter}, 毛利率原始值=${marginRaw}`);
        
        if (!marginRaw || marginRaw === '' || !rocYear || !quarter) {
            console.log(`毛利率數據 ${index}: 跳過 - 缺少必要字段`);
            return;
        }
        
        const margin = parseFloat(String(marginRaw).replace(/,/g, ''));
        if (isNaN(margin)) {
            console.log(`毛利率數據 ${index}: 跳過 - 無法解析數值: ${marginRaw}`);
            return;
        }

        const westYear = convertRocToWestYear(rocYear);
        if (!westYear) {
            console.log(`毛利率數據 ${index}: 跳過 - 無法轉換民國年: ${rocYear}`);
            return;
        }

        const debugInfo = `${rocYear}->${westYear}Q${quarter}`;
        result._debug.ratioYears.push(debugInfo);

        if (quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4') {
            const quarterKey = `${westYear}Q${quarter}`;
            result.profitMargin.quarters[quarterKey] = margin;
            console.log(`✓ 設置季度毛利率: ${quarterKey} = ${margin}%`);
        } else if (quarter === '0') {
            result.profitMargin.year = margin;
            console.log(`✓ 設置年度毛利率: ${westYear} = ${margin}%`);
        }
    });

    // 如果 t187ap17_L 沒有毛利率，從損益表計算
    if (Object.keys(result.profitMargin.quarters).length === 0 && !result.profitMargin.year) {
        console.log('從營益分析表未找到毛利率，嘗試從損益表計算...');
        
        incomeData.forEach((row, index) => {
            if (!row) return;
            
            const rocYear = row['年度'];
            const quarter = row['季別'];
            
            if (!rocYear || !quarter) return;

            const revenueRaw = row['營業收入'];
            const grossProfitRaw = row['營業毛利（毛損）淨額'] || row['營業毛利（毛損）'];
            
            console.log(`計算毛利率 ${index}: 營業收入=${revenueRaw}, 營業毛利=${grossProfitRaw}`);
            
            if (!revenueRaw || !grossProfitRaw) {
                console.log(`計算毛利率 ${index}: 跳過 - 缺少營業收入或毛利數據`);
                return;
            }
            
            const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
            const grossProfit = parseFloat(String(grossProfitRaw).replace(/,/g, ''));
            
            if (isNaN(revenue) || isNaN(grossProfit) || revenue === 0) {
                console.log(`計算毛利率 ${index}: 跳過 - 無效的營業收入或毛利`);
                return;
            }
            
            const margin = (grossProfit / revenue) * 100;
            const westYear = convertRocToWestYear(rocYear);
            if (!westYear) return;

            const marginValue = parseFloat(margin.toFixed(2));

            if (quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4') {
                const quarterKey = `${westYear}Q${quarter}`;
                result.profitMargin.quarters[quarterKey] = marginValue;
                console.log(`✓ 計算季度毛利率: ${quarterKey} = ${marginValue}%`);
            } else if (quarter === '0') {
                result.profitMargin.year = marginValue;
                console.log(`✓ 計算年度毛利率: ${westYear} = ${marginValue}%`);
            }
        });
    }

    // 計算年度毛利率 (最新年度值)
    if (!result.profitMargin.year) {
        const currentYearKeys = Object.keys(result.profitMargin.quarters)
            .filter(key => key.match(/^\d{4}Q[1-4]$/))
            .map(key => parseInt(key.substring(0, 4)));
        
        if (currentYearKeys.length > 0) {
            const currentYear = Math.max(...currentYearKeys);
            const currentYearMargins = Object.entries(result.profitMargin.quarters)
                .filter(([key]) => key.startsWith(currentYear.toString()))
                .map(([_, value]) => value);
            
            if (currentYearMargins.length > 0) {
                // 使用最新年度的最新季度值作為年度參考值
                result.profitMargin.year = currentYearMargins[currentYearMargins.length - 1];
                console.log(`使用最新季度作為年度毛利率: ${result.profitMargin.year}%`);
            }
        }
    }

    // === 解析營收成長率 ===
    console.log('開始解析營收成長率數據...');
    if (revenueData.length > 0) {
        revenueData.forEach((row, index) => {
            if (!row) return;
            
            const rocYearMonth = row['資料年月'];
            const monthGrowthRaw = row['營業收入-上月比較增減(%)']; // 月增率
            const yearGrowthRaw = row['營業收入-去年同月增減(%)'];  // 年增率
            const cumulativeGrowthRaw = row['累計營業收入-前期比較增減(%)']; // 累計年增率
            
            console.log(`營收數據 ${index}: 年月=${rocYearMonth}, 月增率=${monthGrowthRaw}, 年增率=${yearGrowthRaw}, 累計增率=${cumulativeGrowthRaw}`);
            
            if (!rocYearMonth) {
                console.log(`營收數據 ${index}: 跳過 - 缺少年月`);
                return;
            }

            const converted = convertRocYearMonth(rocYearMonth);
            if (!converted) {
                console.log(`營收數據 ${index}: 跳過 - 無法轉換年月: ${rocYearMonth}`);
                return;
            }

            result._debug.revenueMonths.push(`${rocYearMonth}->${converted.westYearMonth}`);

            // 月增率
            if (monthGrowthRaw && monthGrowthRaw !== '') {
                const monthGrowth = parseFloat(String(monthGrowthRaw).replace(/,/g, ''));
                if (!isNaN(monthGrowth)) {
                    result.revenueGrowth.monthOverMonth[converted.westYearMonth] = monthGrowth;
                    console.log(`✓ 設置月增率: ${converted.display} = ${monthGrowth}%`);
                }
            }

            // 年增率
            if (yearGrowthRaw && yearGrowthRaw !== '') {
                const yearGrowth = parseFloat(String(yearGrowthRaw).replace(/,/g, ''));
                if (!isNaN(yearGrowth)) {
                    result.revenueGrowth.yearOverYear[converted.westYearMonth] = yearGrowth;
                    console.log(`✓ 設置年增率: ${converted.display} = ${yearGrowth}%`);
                }
            }

            // 累計年增率 (取最新的)
            if (cumulativeGrowthRaw && cumulativeGrowthRaw !== '' && !result.revenueGrowth.cumulative) {
                const cumulativeGrowth = parseFloat(String(cumulativeGrowthRaw).replace(/,/g, ''));
                if (!isNaN(cumulativeGrowth)) {
                    result.revenueGrowth.cumulative = cumulativeGrowth;
                    console.log(`✓ 設置累計年增率: ${cumulativeGrowth}%`);
                }
            }
        });

        // 計算季營收成長率
        console.log('開始計算季度營收成長率...');
        result.revenueGrowth.quarters = calculateQuarterlyGrowth(revenueData);
    } else {
        console.log('無營收數據可用');
    }

    // 如果沒有累計年增率，使用最新年增率
    if (!result.revenueGrowth.cumulative && Object.keys(result.revenueGrowth.yearOverYear).length > 0) {
        const latestYearGrowth = Object.values(result.revenueGrowth.yearOverYear).pop();
        if (latestYearGrowth) {
            result.revenueGrowth.cumulative = latestYearGrowth;
            console.log(`使用最新年增率作為累計年增率: ${latestYearGrowth}%`);
        }
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
        profitMargin: result.profitMargin
    });

    return result;
}

// === 計算季度營收成長率 ===
function calculateQuarterlyGrowth(revenueData) {
    const growthRates = {};
    const byYearQuarter = {};

    console.log('開始計算季度營收成長率，數據量:', revenueData.length);

    // 按年月分組（資料年月是民國年格式）
    revenueData.forEach((row, index) => {
        if (!row) return;
        
        const rocYearMonth = row['資料年月'];
        if (!rocYearMonth || rocYearMonth.length < 5) {
            console.log(`季度計算 ${index}: 跳過 - 無效年月: ${rocYearMonth}`);
            return;
        }

        const converted = convertRocYearMonth(rocYearMonth);
        if (!converted) {
            console.log(`季度計算 ${index}: 跳過 - 無法轉換年月: ${rocYearMonth}`);
            return;
        }

        const month = parseInt(converted.month);
        const westYear = converted.westYear;
        
        const revenueRaw = row['營業收入-當月營收'];
        
        if (!revenueRaw || revenueRaw === '') {
            console.log(`季度計算 ${index}: 跳過 - 無營收數據`);
            return;
        }
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        if (isNaN(revenue)) {
            console.log(`季度計算 ${index}: 跳過 - 無法解析營收: ${revenueRaw}`);
            return;
        }

        // 確定季度
        let quarter;
        if (month >= 1 && month <= 3) quarter = 'Q1';
        else if (month >= 4 && month <= 6) quarter = 'Q2';
        else if (month >= 7 && month <= 9) quarter = 'Q3';
        else if (month >= 10 && month <= 12) quarter = 'Q4';
        else {
            console.log(`季度計算 ${index}: 跳過 - 無效月份: ${month}`);
            return;
        }

        const key = `${westYear}${quarter}`;
        if (!byYearQuarter[key]) byYearQuarter[key] = 0;
        byYearQuarter[key] += revenue;
        
        console.log(`季度計算 ${index}: ${converted.display} -> ${key}, 營收: ${revenue}`);
    });

    console.log('季度營收匯總:', byYearQuarter);

    // 計算季增率 (本季 vs 上季)
    const quarters = Object.keys(byYearQuarter).sort();
    console.log('排序後的季度:', quarters);
    
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
        
        console.log(`季度比較: ${previousQuarter} -> ${currentQuarter}, 連續: ${isConsecutive}`);
        
        if (isConsecutive) {
            const currentRevenue = byYearQuarter[currentQuarter];
            const previousRevenue = byYearQuarter[previousQuarter];
            
            if (previousRevenue !== 0) {
                const growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
                growthRates[currentQuarter] = parseFloat(growth.toFixed(2));
                console.log(`✓ 計算季增率: ${currentQuarter} = ${growthRates[currentQuarter]}%`);
            } else {
                console.log(`季度比較: 跳過 - 上季營收為零`);
            }
        } else {
            console.log(`季度比較: 跳過 - 季度不連續`);
        }
    }

    console.log('最終季度成長率:', growthRates);
    return growthRates;
}