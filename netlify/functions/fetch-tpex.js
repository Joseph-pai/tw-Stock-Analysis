const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const type = event.queryStringParameters?.type;
    const stockId = event.queryStringParameters?.stock_id;

    console.log(`收到TPEx請求: type=${type}, stock_id=${stockId}`);

    // 結構化財務數據查詢
    if (type === 'financials' && stockId) {
        return await getStructuredTPExFinancials(stockId, headers);
    }

    // 獲取興櫃公司列表
    if (type === 'stocks') {
        return await getTPExStockList(headers);
    }

    return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '無效的請求類型' })
    };
};

// 獲取興櫃公司列表
async function getTPExStockList(headers) {
    try {
        console.log('獲取興櫃公司列表...');
        
        // TPEx API 興櫃公司基本資料
        const url = 'https://www.tpex.org.tw/openapi/v1/tpex_openapi_stkbasicinfo';
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`TPEx API 請求失敗: ${response.status}`);
        }

        const data = await response.json();
        
        // 轉換數據格式
        const stockList = data.map(item => ({
            stock_id: item.公司代號,
            stock_name: item.公司名稱,
            industry_category: item.產業別 || '興櫃其他',
            market_type: 'TPEx', // 標記為興櫃市場
            _source: 'TPEx'
        }));

        console.log(`成功獲取 ${stockList.length} 家興櫃公司資料`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(stockList)
        };

    } catch (error) {
        console.error('獲取興櫃公司列表錯誤:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
}

// 獲取結構化財務數據
async function getStructuredTPExFinancials(stockId, headers) {
    try {
        console.log(`開始獲取興櫃股票 ${stockId} 的結構化財務數據`);

        // 1. 獲取最近期財務報表（綜合損益表）
        const financialStatements = await fetchTPExFinancialStatements(stockId);
        
        // 2. 獲取資產負債表
        const balanceSheets = await fetchTPExBalanceSheets(stockId);
        
        // 3. 獲取月營收數據
        const monthlyRevenues = await fetchTPExMonthlyRevenues(stockId);
        
        console.log(`找到數據: 財務報表 ${financialStatements.length}, 資產負債表 ${balanceSheets.length}, 月營收 ${monthlyRevenues.length}`);

        // 4. 解析並結構化數據
        const result = parseTPExFinancialData(financialStatements, balanceSheets, monthlyRevenues);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('getStructuredTPExFinancials error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: error.message,
                stack: error.stack 
            })
        };
    }
}

// 獲取財務報表（綜合損益表）
async function fetchTPExFinancialStatements(stockId) {
    try {
        const url = `https://www.tpex.org.tw/openapi/v1/tpex_openapi_stkfinstatements?stkno=${stockId}&startyy=2024`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`財務報表請求失敗: ${response.status}`);
        }
        
        const data = await response.json();
        return Array.isArray(data) ? data : [];
        
    } catch (error) {
        console.error('獲取財務報表錯誤:', error);
        return [];
    }
}

// 獲取資產負債表
async function fetchTPExBalanceSheets(stockId) {
    try {
        const url = `https://www.tpex.org.tw/openapi/v1/tpex_openapi_stkbalancesheets?stkno=${stockId}&startyy=2024`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`資產負債表請求失敗: ${response.status}`);
        }
        
        const data = await response.json();
        return Array.isArray(data) ? data : [];
        
    } catch (error) {
        console.error('獲取資產負債表錯誤:', error);
        return [];
    }
}

// 獲取月營收數據
async function fetchTPExMonthlyRevenues(stockId) {
    try {
        const url = `https://www.tpex.org.tw/openapi/v1/tpex_openapi_stkrevenues?stkno=${stockId}&startyy=2024`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`月營收請求失敗: ${response.status}`);
        }
        
        const data = await response.json();
        return Array.isArray(data) ? data : [];
        
    } catch (error) {
        console.error('獲取月營收錯誤:', error);
        return [];
    }
}

// 解析 TPEx 財務數據
function parseTPExFinancialData(financialStatements, balanceSheets, monthlyRevenues) {
    const result = {
        eps: { quarters: {}, year: null },
        roe: { quarters: {}, year: null },
        revenueGrowth: { months: {}, quarters: {}, year: null },
        profitMargin: { quarters: {}, year: null },
        _debug: {
            financialCount: financialStatements.length,
            balanceCount: balanceSheets.length,
            revenueCount: monthlyRevenues.length,
            source: 'TPEx'
        }
    };

    // === 解析 EPS ===
    financialStatements.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        const epsRaw = row['基本每股盈餘（元）'] || row['基本每股盈餘'];
        
        if (!epsRaw || epsRaw === '') return;
        
        const eps = parseFloat(String(epsRaw).replace(/,/g, ''));
        if (isNaN(eps)) return;

        // 季別 "0" 代表年度，"1"~"4" 代表各季度
        if (quarter && quarter !== '0') {
            result.eps.quarters[`Q${quarter}`] = eps;
        } else if (quarter === '0') {
            result.eps.year = eps;
        }
    });

    // === 解析 ROE (計算：淨利 / 股東權益) ===
    financialStatements.forEach(incomeRow => {
        const year = incomeRow['年度'];
        const quarter = incomeRow['季別'];
        
        // 優先使用「歸屬於母公司業主」的淨利
        let netIncomeRaw = incomeRow['淨利（淨損）歸屬於母公司業主'] || 
                          incomeRow['本期淨利（淨損）'] ||
                          incomeRow['本期稅後淨利（淨損）'];
        
        if (!netIncomeRaw || netIncomeRaw === '') return;
        
        const netIncome = parseFloat(String(netIncomeRaw).replace(/,/g, ''));
        if (isNaN(netIncome)) return;

        // 找到對應期間的股東權益
        const balanceRow = balanceSheets.find(b => 
            b['年度'] === year && b['季別'] === quarter
        );

        if (balanceRow) {
            let equityRaw = balanceRow['權益總額'] || 
                           balanceRow['歸屬於母公司業主之權益合計'] ||
                           balanceRow['權益總計'];
            
            if (!equityRaw || equityRaw === '') return;
            
            const equity = parseFloat(String(equityRaw).replace(/,/g, ''));

            if (!isNaN(equity) && equity !== 0) {
                const roe = (netIncome / equity) * 100;

                if (quarter && quarter !== '0') {
                    result.roe.quarters[`Q${quarter}`] = parseFloat(roe.toFixed(2));
                } else if (quarter === '0') {
                    result.roe.year = parseFloat(roe.toFixed(2));
                }
            }
        }
    });

    // === 解析毛利率 ===
    financialStatements.forEach(row => {
        const year = row['年度'];
        const quarter = row['季別'];
        
        const revenueRaw = row['營業收入'];
        const costRaw = row['營業成本'] || row['銷貨成本'];
        
        if (!revenueRaw || !costRaw) return;
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        const cost = parseFloat(String(costRaw).replace(/,/g, ''));
        
        if (isNaN(revenue) || isNaN(cost) || revenue === 0) return;
        
        const grossProfit = revenue - cost;
        const margin = (grossProfit / revenue) * 100;

        if (quarter && quarter !== '0') {
            result.profitMargin.quarters[`Q${quarter}`] = parseFloat(margin.toFixed(2));
        } else if (quarter === '0') {
            result.profitMargin.year = parseFloat(margin.toFixed(2));
        }
    });

    // === 解析營收成長率 ===
    if (monthlyRevenues.length > 0) {
        // 按日期排序（從新到舊）
        const sortedRevenues = [...monthlyRevenues].sort((a, b) => {
            const dateA = a['資料年月'] || '';
            const dateB = b['資料年月'] || '';
            return dateB.localeCompare(dateA);
        });

        // 月營收成長率
        sortedRevenues.forEach((row, index) => {
            const yearMonth = row['資料年月']; // 格式: "11311" (民國年YYYYMM)
            const currentRevenueRaw = row['當月營收'];
            
            if (!yearMonth || !currentRevenueRaw || currentRevenueRaw === '') return;
            
            // 如果有上個月的數據，計算月增率
            if (index < sortedRevenues.length - 1) {
                const prevRow = sortedRevenues[index + 1];
                const prevRevenueRaw = prevRow['當月營收'];
                
                if (prevRevenueRaw && prevRevenueRaw !== '') {
                    const currentRevenue = parseFloat(String(currentRevenueRaw).replace(/,/g, ''));
                    const prevRevenue = parseFloat(String(prevRevenueRaw).replace(/,/g, ''));
                    
                    if (!isNaN(currentRevenue) && !isNaN(prevRevenue) && prevRevenue > 0) {
                        const monthGrowth = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
                        result.revenueGrowth.months[yearMonth] = parseFloat(monthGrowth.toFixed(2));
                    }
                }
            }
            
            // 計算年增率（與去年同期比較）
            if (sortedRevenues.length > 12) {
                // 找去年同月數據
                const sameMonthLastYear = findSameMonthLastYear(sortedRevenues, yearMonth);
                if (sameMonthLastYear) {
                    const currentRevenue = parseFloat(String(currentRevenueRaw).replace(/,/g, ''));
                    const lastYearRevenue = parseFloat(String(sameMonthLastYear['當月營收']).replace(/,/g, ''));
                    
                    if (!isNaN(currentRevenue) && !isNaN(lastYearRevenue) && lastYearRevenue > 0) {
                        const yearGrowth = ((currentRevenue - lastYearRevenue) / lastYearRevenue) * 100;
                        result.revenueGrowth.months[`${yearMonth}_yoy`] = parseFloat(yearGrowth.toFixed(2));
                    }
                }
            }
        });

        // 年度營收成長率（使用累計營收）
        const currentYearTotal = calculateYearlyTotal(sortedRevenues, 0);
        const lastYearTotal = calculateYearlyTotal(sortedRevenues, 12);
        
        if (currentYearTotal > 0 && lastYearTotal > 0) {
            const yearlyGrowth = ((currentYearTotal - lastYearTotal) / lastYearTotal) * 100;
            result.revenueGrowth.year = parseFloat(yearlyGrowth.toFixed(2));
        }

        // 計算季度營收成長率
        result.revenueGrowth.quarters = calculateTPExQuarterlyGrowth(sortedRevenues);
    }

    return result;
}

// 尋找去年同月數據
function findSameMonthLastYear(revenues, yearMonth) {
    // yearMonth 格式: "11311" -> 民國113年11月
    if (!yearMonth || yearMonth.length < 5) return null;
    
    const rocYear = parseInt(yearMonth.substring(0, 3));
    const month = yearMonth.substring(3, 5);
    const lastYearRoc = (rocYear - 1).toString().padStart(3, '0');
    const targetYearMonth = `${lastYearRoc}${month}`;
    
    return revenues.find(row => row['資料年月'] === targetYearMonth);
}

// 計算年度總營收
function calculateYearlyTotal(revenues, offset) {
    // offset: 0 = 今年, 12 = 去年
    const monthlyRevenues = revenues.slice(offset, offset + 12);
    return monthlyRevenues.reduce((total, row) => {
        const revenueRaw = row['當月營收'];
        if (!revenueRaw || revenueRaw === '') return total;
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        return total + (isNaN(revenue) ? 0 : revenue);
    }, 0);
}

// 計算季度營收成長率
function calculateTPExQuarterlyGrowth(revenues) {
    const growthRates = {};
    
    // 分組季度營收
    const quarterlyData = {};
    
    revenues.forEach(row => {
        const yearMonth = row['資料年月'];
        if (!yearMonth || yearMonth.length < 5) return;
        
        // 民國年轉西元年
        const rocYear = parseInt(yearMonth.substring(0, 3));
        const westYear = rocYear + 1911;
        const month = parseInt(yearMonth.substring(3, 5));
        const quarter = Math.floor((month + 2) / 3);
        const quarterKey = `${westYear}Q${quarter}`;
        
        const revenueRaw = row['當月營收'];
        if (!revenueRaw || revenueRaw === '') return;
        
        const revenue = parseFloat(String(revenueRaw).replace(/,/g, ''));
        if (isNaN(revenue)) return;
        
        if (!quarterlyData[quarterKey]) {
            quarterlyData[quarterKey] = 0;
        }
        quarterlyData[quarterKey] += revenue;
    });
    
    // 計算季度成長率
    const quarterKeys = Object.keys(quarterlyData).sort();
    for (let i = 4; i < quarterKeys.length; i++) {
        const current = quarterlyData[quarterKeys[i]];
        const previous = quarterlyData[quarterKeys[i - 4]];
        
        if (previous > 0) {
            const growth = ((current - previous) / previous) * 100;
            const quarterLabel = quarterKeys[i].slice(-2); // Q1, Q2, Q3, Q4
            growthRates[quarterLabel] = parseFloat(growth.toFixed(2));
        }
    }
    
    return growthRates;
}