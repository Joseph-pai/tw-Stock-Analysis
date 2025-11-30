const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // CORS 頭部
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // 從查詢參數中獲取 FinMind 所需的參數
    const { dataset, data_id, start_date, token } = event.queryStringParameters;
    
    if (!dataset) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                error: 'Missing required parameter: dataset',
                success: false
            })
        };
    }

    console.log(`FinMind查詢: dataset=${dataset}, data_id=${data_id}`);

    // 建構 FinMind API URL
    let url = `https://api.finmindtrade.com/api/v4/data?dataset=${dataset}`;
    if (data_id) url += `&data_id=${data_id}`;
    if (start_date) url += `&start_date=${start_date}`;
    if (token) url += `&token=${token}`;

    try {
        const response = await fetchWithTimeout(url, 15000); // 15秒超時
        
        if (!response.ok) {
            console.error(`FinMind API HTTP錯誤: ${response.status} ${response.statusText}`);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ 
                    error: `FinMind API Error: ${response.status} ${response.statusText}`,
                    success: false,
                    source: 'finmind'
                })
            };
        }

        const data = await response.json();
        
        // 檢查 FinMind 返回的數據結構
        if (!data) {
            console.error('FinMind返回空數據');
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'FinMind返回空數據',
                    success: false,
                    source: 'finmind',
                    data_id: data_id
                })
            };
        }

        // 檢查是否有錯誤訊息
        if (data.msg && data.msg !== 'success') {
            console.error(`FinMind業務錯誤: ${data.msg}`);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: `FinMind: ${data.msg}`,
                    success: false,
                    source: 'finmind',
                    data_id: data_id
                })
            };
        }

        // 檢查數據是否為空數組
        if (Array.isArray(data.data) && data.data.length === 0) {
            console.log(`FinMind無數據: dataset=${dataset}, data_id=${data_id}`);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'FinMind無此股票數據',
                    success: false,
                    source: 'finmind',
                    data_id: data_id,
                    dataset: dataset,
                    emptyData: true // 標記為空數據，便於fallback判斷
                })
            };
        }

        // 檢查數據結構是否有效
        if (!data.data || (Array.isArray(data.data) && data.data.length === 0)) {
            console.log(`FinMind數據結構無效:`, data);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'FinMind數據結構無效',
                    success: false,
                    source: 'finmind',
                    data_id: data_id,
                    dataset: dataset
                })
            };
        }

        console.log(`FinMind查詢成功: dataset=${dataset}, data_id=${data_id}, 數據量=${Array.isArray(data.data) ? data.data.length : 'object'}`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ...data,
                success: true,
                source: 'finmind',
                data_id: data_id,
                dataset: dataset,
                count: Array.isArray(data.data) ? data.data.length : 1
            })
        };

    } catch (error) {
        console.error('FinMind查詢錯誤:', error);
        
        // 區分超時錯誤和其他錯誤
        if (error.message.includes('timeout')) {
            return {
                statusCode: 408,
                headers,
                body: JSON.stringify({ 
                    error: 'FinMind API請求超時',
                    success: false,
                    source: 'finmind',
                    data_id: data_id
                })
            };
        }
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: `FinMind查詢失敗: ${error.message}`,
                success: false,
                source: 'finmind',
                data_id: data_id
            })
        };
    }
};

// 帶超時的fetch函數
function fetchWithTimeout(url, timeout = 15000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Request timeout for ${url}`)), timeout)
        )
    ]);
}

// 專門用於財務數據查詢的輔助函數
async function fetchFinMindFinancials(stockId, token) {
    const datasets = [
        'TaiwanStockFinancialStatements',
        'TaiwanStockBalanceSheet',
        'TaiwanStockMonthRevenue'
    ];
    
    const results = {};
    
    for (const dataset of datasets) {
        try {
            const url = `https://api.finmindtrade.com/api/v4/data?dataset=${dataset}&data_id=${stockId}&token=${token}`;
            const response = await fetchWithTimeout(url, 10000);
            
            if (!response.ok) continue;
            
            const data = await response.json();
            
            if (data && data.data && data.data.length > 0) {
                results[dataset] = data.data;
            }
        } catch (error) {
            console.warn(`FinMind ${dataset} 查詢失敗:`, error.message);
            // 繼續查詢其他dataset
        }
    }
    
    return results;
}

// 專門用於股價數據查詢
async function fetchFinMindPrice(stockId, token, startDate = null) {
    try {
        let url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockId}&token=${token}`;
        if (startDate) {
            url += `&start_date=${startDate}`;
        }
        
        const response = await fetchWithTimeout(url, 10000);
        
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        
        if (data && data.data && data.data.length > 0) {
            return data.data;
        }
        
        return null;
    } catch (error) {
        console.warn('FinMind股價查詢失敗:', error.message);
        return null;
    }
}

// 導出輔助函數供其他模塊使用
exports.fetchFinMindFinancials = fetchFinMindFinancials;
exports.fetchFinMindPrice = fetchFinMindPrice;