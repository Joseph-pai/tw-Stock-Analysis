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

    console.log(`收到TWSE請求: type=${type}, stock_id=${stockId}`);

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
        return { 
            statusCode: 400, 
            headers, 
            body: JSON.stringify({ 
                error: 'Invalid type',
                availableTypes: Object.keys(sources)
            }) 
        };
    }

    try {
        const requests = targetUrls.map(url => 
            fetchWithTimeout(url, 10000) // 10秒超時
                .then(res => {
                    if (!res.ok) {
                        console.warn(`TWSE API ${url} 響應失敗: ${res.status}`);
                        return [];
                    }
                    return res.json().catch(() => {
                        console.warn(`TWSE API ${url} JSON解析失敗`);
                        return [];
                    });
                })
                .catch(error => {
                    console.warn(`TWSE API ${url} 請求失敗:`, error.message);
                    return [];
                })
        );
        
        const results = await Promise.all(requests);
        const combinedData = results.flat().filter(item => 
            item && (item['公司代號'] || item['公司代碼'])
        );

        console.log(`TWSE原始數據查詢成功: type=${type}, 數據量=${combinedData.length}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                data: combinedData,
                count: combinedData.length,
                source: 'twse',
                type: type
            }),
        };
    } catch (error) {
        console.error('TWSE原始數據獲取錯誤:', error);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ 
                error: `TWSE數據獲取失敗: ${error.message}`,
                type: type
            }) 
        };
    }
};

// === 核心：結構化財務數據處理 ===
async function getStructuredFinancials(stockId, headers) {
    try {
        console.log(`開始獲取股票 ${stockId} 的TWSE結構化財務數據`);

        // 1. 並行抓取所有需要的數據源（帶超時和錯誤處理）
        const [incomeRes, balanceRes, revenueRes, ratioRes] = await Promise.all([
            // 綜合損益表（包含 EPS、淨利）
            Promise.all([
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', 10000),
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh', 10000),
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd', 10000),
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins', 10000)
            ]).then(async (responses) => {
                const results = [];
                for (const response of responses) {
                    if (response.ok) {
                        try {
                            const data = await response.json();
                            results.push(data);
                        } catch (e) {
                            console.warn('損益表JSON解析失敗:', e.message);
                            results.push([]);
                        }
                    } else {
                        results.push([]);
                    }
                }
                return results;
            }).catch(() => [[], [], [], []]),
            
            // 資產負債表（包含股東權益）
            Promise.all([
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci', 10000),
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_fh', 10000),
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_bd', 10000),
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ins', 10000)
            ]).then(async (responses) => {
                const results = [];
                for (const response of responses) {
                    if (response.ok) {
                        try {
                            const data = await response.json();
                            results.push(data);
                        } catch (e) {
                            console.warn('資產負債表JSON解析失敗:', e.message);
                            results.push([]);
                        }
                    } else {
                        results.push([]);
                    }
                }
                return results;
            }).catch(() => [[], [], [], []]),
            
            // 月營收（包含月/年營收增率）
            fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap05_L', 10000)
                .then(async r => {
                    if (!r.ok) return [];
                    try {
                        return await r.json();
                    } catch (e) {
                        console.warn('月營收JSON解析失敗:', e.message);
                        return [];
                    }
                })
                .catch(() => []),
            
            // 營益分析（包含毛利率）
            fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap17_L', 10000)
                .then(async r => {
                    if (!r.ok) return [];
                    try {
                        return await r.json();
                    } catch (e) {
                        console.warn('營益分析JSON解析失敗:', e.message);
                        return [];
                    }
                })
                .catch(() => [])
        ]);

        // 2. 合併並過濾該股票的數據
        const allIncome = incomeRes.flat().filter(row => 
            row && row['公司代號'] === stockId
        );
        const allBalance = balanceRes.flat().filter(row => 
            row && row['公司代號'] === stockId
        );
        const allRevenue = Array.isArray(revenueRes) ? revenueRes.filter(row => 
            row && row['公司代號'] === stockId
        ) : [];
        const allRatio = Array.isArray(ratioRes) ? ratioRes.filter(row => 
            row && row['公司代號'] === stockId
        ) : [];

        console.log(`TWSE數據統計: 損益表 ${allIncome.length}, 資產負債表 ${allBalance.length}, 月營收 ${allRevenue.length}, 營益分析 ${allRatio.length}`);

        // 3. 檢查是否有足夠的數據
        if (allIncome.length === 0 && allBalance.length === 0 && allRevenue.length === 0 && allRatio.length === 0) {
            console.log(`TWSE無股票 ${stockId} 的財務數據`);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: `TWSE無此股票財務數據`,
                    stockId: stockId,
                    source: 'twse'
                })
            };
        }

        // 4. 解析並結構化數據
        const result = parseFinancialData(allIncome, allBalance, allRevenue, allRatio);

        // 5. 檢查解析後的數據是否有效
        const hasValidData = 
            result.eps.year !== null || 
            Object.keys(result.eps.quarters).length > 0 ||
            result.roe.year !== null || 
            Object.keys(result.roe.quarters).length > 0 ||
            result.revenueGrowth.year !== null ||
            Object.keys(result.revenueGrowth.months).length > 0;

        if (!hasValidData) {
            console.log(`TWSE股票 ${stockId} 解析後無有效財務指標`);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: `TWSE無有效財務指標數據`,
                    stockId: stockId,
                    source: 'twse',
                    debug: result._debug
                })
            };
        }

        console.log(`TWSE結構化財務數據查詢成功: ${stockId}`);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ...result,
                stockId: stockId,
                source: 'twse',
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('getStructuredFinancials error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: `TWSE結構化數據獲取失敗: ${error.message}`,
                stockId: stockId,
                source: 'twse'
            })
        };
    }
}

// 帶超時的fetch函數
function fetchWithTimeout(url, timeout = 10000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Request timeout for ${url}`)), timeout)
        )
    ]);
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
            ratioCount: ratioData.length,
            parsedEPS: 0,
            parsedROE: 0,
            parsedMargin: 0,
            parsedRevenueGrowth: 0
        }
    };

    // === 解析 EPS ===
    incomeData.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        const epsRaw = row['基本每股盈餘（元）'];
        
        if (!epsRaw || epsRaw === '' || epsRaw === '-') return;
        
        const eps = parseFloat(String(epsRaw).replace(/,/g, ''));
        if (isNaN(eps)) return;

        // 季別 "0" 代表年度，"1"~"4" 代表各季度
        if (quarter && quarter !== '0') {
            result.eps.quarters[`Q${quarter}`] = eps;
            result._debug.parsedEPS++;
        } else if (quarter === '0') {
            result.eps.year = eps;
            result._debug.parsedEPS++;
        }
    });

    // === 解析 ROE (計算：淨利 / 股東權益) ===
    incomeData.forEach(incomeRow => {
        const year = incomeRow['年度'];
        const quarter = incomeRow['季別'];
        
        // 優先使用「歸屬於母公司業主」的淨利
        let netIncomeRaw = incomeRow['淨利（淨損）歸屬於母公司業主'] || 
                          incomeRow['本期淨利（淨損）'];
        
        if (!netIncomeRaw || netIncomeRaw === '' || netIncomeRaw === '-') return;
        
        const netIncome = parseFloat(String(netIncomeRaw).replace(/,/g, ''));
        if (isNaN(netIncome)) return;

        // 找到對應期間的股東權益
        const balanceRow = balanceData.find(b => 
            b && b['年度'] === year && b['季別'] === quarter
        );

        if (balanceRow) {
            let equityRaw = balanceRow['權益總額'] || 
                           balanceRow['歸屬於母公司業主之權益合計'];
            
            if (!equityRaw || equityRaw === '' || equityRaw === '-') return;
            
            const equity = parseFloat(String(equityRaw).replace(/,/g, ''));

            if (!isNaN(equity) && equity !== 0) {
                const roe = (netIncome / equity) * 100;

                if (quarter && quarter !== '0') {
                    result.roe.quarters[`Q${quarter}`] = parseFloat(roe.toFixed(2));
                    result._debug.parsedROE++;
                } else if (quarter === '0') {
                    result.roe.year = parseFloat(roe.toFixed(2));
                    result._debug.parsedROE++;
                }
            }
        }
    });

    // === 解析毛利率（直接從 t187ap17_L 取得）===
    ratioData.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        const marginRaw = row['毛利率(%)(營業毛利)/(營業收入)'];
        
        if (!marginRaw || marginRaw === '' || marginRaw === '-') return;
        
        const margin = parseFloat(String(marginRaw).replace(/,/g, ''));
        if (isNaN(margin)) return;

        if (quarter && quarter !== '0') {
            result.profitMargin.quarters[`Q${quarter}`] = margin;
            result._debug.parsedMargin++;
        } else if (quarter === '0') {
            result.profitMargin.year = margin;
            result._debug.parsedMargin++;
        }
    });

    // 如果 t187ap17_L 沒有毛利率，從損益表計算
    if (Object.keys(result.profitMargin.quarters).length === 0 && !result.profitMargin.year) {
        incomeData.forEach(row => {
            const year = row['年度'];
            const quarter = row['季別'];
            
            const revenueRaw = row['營業收入'];
            const grossProfitRaw = row['營業毛利（毛損）淨額'] || row['營業毛利（毛損）'];
            
            if (!revenueRaw || !grossProfitRaw || revenueRaw === '-' || grossProfitRaw === '-') return;
            
            const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
            const grossProfit = parseFloat(String(grossProfitRaw).replace(/,/g, ''));
            
            if (isNaN(revenue) || isNaN(grossProfit) || revenue === 0) return;
            
            const margin = (grossProfit / revenue) * 100;

            if (quarter && quarter !== '0') {
                result.profitMargin.quarters[`Q${quarter}`] = parseFloat(margin.toFixed(2));
                result._debug.parsedMargin++;
            } else if (quarter === '0') {
                result.profitMargin.year = parseFloat(margin.toFixed(2));
                result._debug.parsedMargin++;
            }
        });
    }

    // === 解析營收成長率 ===
    if (revenueData.length > 0) {
        // 月營收增率 - 直接從 API 取得
        revenueData.forEach(row => {
            const yearMonth = row['資料年月']; // 格式: "11411" (民國年YYYYMM)
            const monthGrowthRaw = row['營業收入-去年同月增減(%)'];
            
            if (!yearMonth || !monthGrowthRaw || monthGrowthRaw === '' || monthGrowthRaw === '-') return;
            
            const monthGrowth = parseFloat(String(monthGrowthRaw).replace(/,/g, ''));
            if (!isNaN(monthGrowth)) {
                result.revenueGrowth.months[yearMonth] = monthGrowth;
                result._debug.parsedRevenueGrowth++;
            }
        });

        // 年營收增率 - 使用「累計營收增減率」
        const sortedRevenue = [...revenueData].sort((a, b) => 
            (b['資料年月'] || '').localeCompare(a['資料年月'] || '')
        );
        
        if (sortedRevenue.length > 0) {
            const latestYearGrowthRaw = sortedRevenue[0]['累計營業收入-前期比較增減(%)'];
            if (latestYearGrowthRaw && latestYearGrowthRaw !== '' && latestYearGrowthRaw !== '-') {
                const latestYearGrowth = parseFloat(String(latestYearGrowthRaw).replace(/,/g, ''));
                if (!isNaN(latestYearGrowth)) {
                    result.revenueGrowth.year = latestYearGrowth;
                    result._debug.parsedRevenueGrowth++;
                }
            }
        }

        // 計算季營收成長率
        const quarterlyGrowth = calculateQuarterlyGrowth(revenueData);
        Object.assign(result.revenueGrowth.quarters, quarterlyGrowth);
    }

    return result;
}

// === 計算季度營收成長率 ===
function calculateQuarterlyGrowth(revenueData) {
    const quarters = {};
    const byYear = {};

    // 按年月分組（資料年月是民國年格式，如 "11411" = 民國114年11月）
    revenueData.forEach(row => {
        const ym = row['資料年月'];
        if (!ym || ym.length < 5) return;

        // 民國年格式：前3碼是年份，後2碼是月份
        const rocYear = ym.substring(0, 3); // 民國年：如 "114"
        const month = parseInt(ym.substring(3, 5)); // 月份：如 "11"
        const westYear = (parseInt(rocYear) + 1911).toString(); // 轉西元年：2025
        
        const revenueRaw = row['營業收入-當月營收'];
        
        if (!revenueRaw || revenueRaw === '' || revenueRaw === '-') return;
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        if (isNaN(revenue)) return;

        if (!byYear[westYear]) byYear[westYear] = {};
        byYear[westYear][month] = revenue;
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
        if (idx === 0) return;
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