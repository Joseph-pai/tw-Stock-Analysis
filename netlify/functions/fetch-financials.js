const fetch = require('node-fetch');

/**
 * 智能財報數據查詢協調器
 */
exports.handler = async (event, context) => {
    const stockId = event.queryStringParameters.id;
    
    if (!stockId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing stock ID (id parameter)' }),
        };
    }

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        console.log(`開始查詢股票 ${stockId} 的財務數據`);

        // 1. 先檢查是否為興櫃股票
        const isXingGui = await checkIfXingGuiStock(stockId);
        if (isXingGui) {
            console.log(`股票 ${stockId} 為興櫃股票，使用興櫃專用查詢`);
            return await fetchXingGuiFinancials(stockId, headers);
        }

        // 2. 嘗試 FinMind
        console.log(`嘗試 FinMind 查詢股票 ${stockId}`);
        const finmindData = await fetchFinMindFinancials(stockId);
        if (finmindData.success) {
            console.log(`FinMind 查詢成功`);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    ...finmindData.data,
                    source: 'finmind',
                    stockId: stockId
                })
            };
        }

        // 3. 嘗試 TWSE 結構化數據
        console.log(`FinMind 無數據，嘗試 TWSE 查詢股票 ${stockId}`);
        const twseData = await fetchTWSEFinancials(stockId);
        if (twseData.success) {
            console.log(`TWSE 查詢成功`);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    ...twseData.data,
                    source: 'twse',
                    stockId: stockId
                })
            };
        }

        // 4. 最後 fallback 到 Yahoo Finance
        console.log(`TWSE 無數據，fallback 到 Yahoo Finance 查詢股票 ${stockId}`);
        const yahooData = await fetchYahooFinancials(stockId);
        if (yahooData.success) {
            console.log(`Yahoo Finance 查詢成功`);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    ...yahooData.data,
                    source: 'yahoo',
                    stockId: stockId
                })
            };
        }

        // 所有數據源都失敗
        console.log(`所有數據源查詢失敗 for stock ${stockId}`);
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ 
                error: '無法從任何數據源獲取財務數據',
                stockId: stockId,
                sources_tried: ['finmind', 'twse', 'yahoo']
            })
        };

    } catch (error) {
        console.error('財務數據查詢協調器錯誤:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: `內部伺服器錯誤: ${error.message}`,
                stockId: stockId
            })
        };
    }
};

// 檢查是否為興櫃股票
async function checkIfXingGuiStock(stockId) {
    try {
        // 簡單判斷：4位數代碼且嘗試從TPEx獲取數據
        const tpexUrl = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&o=json&stkno=${stockId}`;
        const response = await fetch(tpexUrl);
        return response.ok;
    } catch (error) {
        console.error('檢查興櫃股票錯誤:', error);
        return false;
    }
}

// FinMind 財務數據查詢 - 修復：直接呼叫外部API
async function fetchFinMindFinancials(stockId) {
    try {
        // 直接呼叫 FinMind API，不使用內部函數
        const finmindUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=${stockId}`;
        
        const response = await fetch(finmindUrl);
        if (!response.ok) {
            return { success: false, error: `FinMind API 錯誤: ${response.status}` };
        }

        const data = await response.json();
        
        if (data && data.data && data.data.length > 0) {
            const parsedData = parseFinMindData(data.data);
            return { success: true, data: parsedData };
        } else {
            return { success: false, error: 'FinMind 無數據' };
        }

    } catch (error) {
        console.error('FinMind 查詢錯誤:', error);
        return { success: false, error: error.message };
    }
}

// TWSE 財務數據查詢 - 修復：直接呼叫外部API
async function fetchTWSEFinancials(stockId) {
    try {
        // 直接呼叫 TWSE API
        const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${stockId}.tw|otc_${stockId}.tw`;
        
        const response = await fetch(twseUrl);
        if (!response.ok) {
            return { success: false, error: `TWSE API 錯誤: ${response.status}` };
        }

        const data = await response.json();
        
        if (data && data.msgArray && data.msgArray.length > 0) {
            const stockInfo = data.msgArray[0];
            const unifiedData = {
                eps: parseFloat(stockInfo.eps) || null,
                peRatio: parseFloat(stockInfo.pe) || null,
                price: parseFloat(stockInfo.z) || null,
                date: stockInfo.d || null
            };
            return { success: true, data: unifiedData };
        } else {
            return { success: false, error: 'TWSE 無數據' };
        }

    } catch (error) {
        console.error('TWSE 查詢錯誤:', error);
        return { success: false, error: error.message };
    }
}

// Yahoo Finance 財務數據查詢
async function fetchYahooFinancials(stockId) {
    try {
        const symbol = `${stockId}.TW`;
        const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData`;

        const response = await fetch(yahooUrl);
        
        if (!response.ok) {
            return { success: false, error: `Yahoo API 錯誤: ${response.status}` };
        }

        const data = await response.json();
        
        if (data?.quoteSummary?.result?.[0]) {
            const parsedData = parseYahooData(data.quoteSummary.result[0]);
            return { success: true, data: parsedData };
        } else {
            return { success: false, error: 'Yahoo Finance 無數據' };
        }

    } catch (error) {
        console.error('Yahoo Finance 查詢錯誤:', error);
        return { success: false, error: error.message };
    }
}

// 興櫃財務數據查詢 - 修復：直接呼叫TPEx API
async function fetchXingGuiFinancials(stockId, headers) {
    try {
        // 直接呼叫 TPEx API 獲取興櫃基本資訊
        const basicUrl = `https://www.tpex.org.tw/web/regular_emerging/raising/raising_result.php?l=zh-tw&o=json&stkno=${stockId}`;
        
        const response = await fetch(basicUrl);
        if (!response.ok) {
            throw new Error(`興櫃數據查詢失敗: ${response.status}`);
        }

        const data = await response.json();
        
        const unifiedData = {
            stockId: stockId,
            name: data.aaData?.[0]?.[1] || '未知',
            industry: data.aaData?.[0]?.[2] || '未知',
            listingDate: data.aaData?.[0]?.[3] || '未知',
            source: 'tpex_xinggui'
        };
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(unifiedData)
        };

    } catch (error) {
        console.error('興櫃數據查詢錯誤:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `興櫃數據查詢錯誤: ${error.message}` })
        };
    }
}

// 解析 FinMind 數據
function parseFinMindData(finmindData) {
    if (!finmindData || finmindData.length === 0) return {};
    
    // 按日期排序，獲取最新數據
    const sortedData = [...finmindData].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
    );
    
    const latest = sortedData[0];
    return {
        eps: latest.eps || null,
        revenue: latest.revenue || null,
        profit: latest.profit || null,
        roe: latest.roe || null,
        date: latest.date || null
    };
}

// 解析 Yahoo Finance 數據
function parseYahooData(yahooData) {
    const financialData = yahooData.financialData || {};
    const defaultKeyStatistics = yahooData.defaultKeyStatistics || {};
    
    return {
        eps: financialData.epsTrailingTwelveMonths || financialData.epsCurrentYear,
        revenue: financialData.totalRevenue,
        profit: financialData.grossProfits,
        roe: financialData.returnOnEquity,
        currentPrice: financialData.currentPrice,
        targetMeanPrice: financialData.targetMeanPrice,
        recommendation: financialData.recommendationKey
    };
}