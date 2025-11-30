const fetch = require('node-fetch');

/**
 * 智能財報數據查詢協調器
 * 查詢順序: FinMind → TWSE → Yahoo Finance
 * 興櫃股票: 直接使用興櫃專用查詢
 */
exports.handler = async (event, context) => {
    const stockId = event.queryStringParameters.id;
    
    if (!stockId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing stock ID (id parameter)' }),
        };
    }

    // CORS 頭部
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
        // 簡單的興櫃股票判斷邏輯（可根據實際需求調整）
        // 興櫃股票通常是4位數代碼，且不在上市上櫃名單中
        const listedStocks = await fetchListedStocks();
        return !listedStocks.includes(stockId);
    } catch (error) {
        console.error('檢查興櫃股票錯誤:', error);
        // 如果檢查失敗，默認不是興櫃股票
        return false;
    }
}

// 獲取上市上櫃股票列表（緩存機制）
let listedStocksCache = null;
let cacheTimestamp = null;

async function fetchListedStocks() {
    // 緩存10分鐘
    if (listedStocksCache && cacheTimestamp && (Date.now() - cacheTimestamp) < 10 * 60 * 1000) {
        return listedStocksCache;
    }

    try {
        // 這裡可以從 TWSE 或其他來源獲取股票列表
        // 暫時返回空數組，後續可以完善
        listedStocksCache = [];
        cacheTimestamp = Date.now();
        return listedStocksCache;
    } catch (error) {
        console.error('獲取股票列表錯誤:', error);
        return [];
    }
}

// FinMind 財務數據查詢
async function fetchFinMindFinancials(stockId) {
    try {
        const finmindUrl = `/.netlify/functions/fetch-finmind?dataset=TaiwanStockFinancialStatements&data_id=${stockId}&token=your_finmind_token`;
        
        const response = await fetch(finmindUrl);
        if (!response.ok) {
            return { success: false, error: `FinMind API 錯誤: ${response.status}` };
        }

        const data = await response.json();
        
        // 檢查 FinMind 是否返回有效數據
        if (data && data.data && data.data.length > 0) {
            // 解析 FinMind 財務數據
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

// TWSE 財務數據查詢
async function fetchTWSEFinancials(stockId) {
    try {
        const twseUrl = `/.netlify/functions/fetch-twse?type=financials&stock_id=${stockId}`;
        
        const response = await fetch(twseUrl);
        if (!response.ok) {
            return { success: false, error: `TWSE API 錯誤: ${response.status}` };
        }

        const data = await response.json();
        
        // 檢查 TWSE 是否返回有效數據
        if (data && (data.eps || data.roe || data.revenueGrowth || data.profitMargin)) {
            // 統一數據格式
            const unifiedData = unifyFinancialData(data, 'twse');
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
        
        // 檢查 Yahoo Finance 是否返回有效數據
        if (data?.quoteSummary?.result?.[0]) {
            // 解析 Yahoo Finance 數據
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

// 興櫃財務數據查詢
async function fetchXingGuiFinancials(stockId, headers) {
    try {
        const xingguiUrl = `/.netlify/functions/fetch-xinggui?stockId=${stockId}&dataType=financials`;
        
        const response = await fetch(xingguiUrl);
        if (!response.ok) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: `興櫃數據查詢失敗: ${response.status}` })
            };
        }

        const data = await response.json();
        
        // 統一數據格式
        const unifiedData = unifyFinancialData(data, 'xinggui');
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ...unifiedData,
                source: 'xinggui',
                stockId: stockId
            })
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
    // 這裡需要根據 FinMind 的實際數據結構進行解析
    // 暫時返回基本結構，後續完善
    return {
        eps: getLatestEPS(finmindData),
        revenue: getLatestRevenue(finmindData),
        profit: getLatestProfit(finmindData),
        roe: getLatestROE(finmindData),
        // 其他財務指標...
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
        recommendation: financialData.recommendationKey,
        // 其他指標...
    };
}

// 統一財務數據格式
function unifyFinancialData(rawData, source) {
    // 根據數據源統一數據格式
    switch (source) {
        case 'twse':
            return {
                eps: rawData.eps?.year || rawData.eps?.quarters?.Q4 || null,
                revenue: null, // TWSE 需要從其他字段獲取
                profit: null,  // TWSE 需要從其他字段獲取
                roe: rawData.roe?.year || rawData.roe?.quarters?.Q4 || null,
                profitMargin: rawData.profitMargin?.year || rawData.profitMargin?.quarters?.Q4 || null,
                revenueGrowth: rawData.revenueGrowth?.year || null,
                rawData: rawData // 保留原始數據供後續處理
            };
            
        case 'xinggui':
            return {
                eps: rawData.eps,
                revenue: rawData.revenue,
                profit: rawData.profit,
                roe: rawData.roe,
                rawData: rawData
            };
            
        case 'finmind':
        case 'yahoo':
        default:
            return rawData;
    }
}

// 輔助函數 - 從 FinMind 數據中提取最新 EPS
function getLatestEPS(finmindData) {
    if (!finmindData || finmindData.length === 0) return null;
    
    // 按日期排序，獲取最新數據
    const sortedData = [...finmindData].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
    );
    
    return sortedData[0]?.eps || null;
}

// 其他輔助函數...
function getLatestRevenue(finmindData) {
    // 實現邏輯...
    return null;
}

function getLatestProfit(finmindData) {
    // 實現邏輯...
    return null;
}

function getLatestROE(finmindData) {
    // 實現邏輯...
    return null;
}