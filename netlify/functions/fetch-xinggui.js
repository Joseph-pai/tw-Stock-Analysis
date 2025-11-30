const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const { stockId, dataType = 'financials' } = event.queryStringParameters;
    
    if (!stockId) {
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({ 
                error: '缺少股票代碼參數',
                success: false
            })
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

    console.log(`興櫃數據查詢: stockId=${stockId}, dataType=${dataType}`);

    try {
        let result;
        
        switch(dataType) {
            case 'basic':
                result = await fetchXingGuiBasicInfo(stockId);
                break;
            case 'financials':
                result = await fetchXingGuiFinancials(stockId);
                break;
            case 'price':
                result = await fetchXingGuiPrice(stockId);
                break;
            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: `不支持的數據類型: ${dataType}`,
                        success: false,
                        availableTypes: ['basic', 'financials', 'price']
                    })
                };
        }

        // 檢查是否有有效數據
        if (!result || Object.keys(result).length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: `興櫃無此股票數據: ${stockId}`,
                    success: false,
                    source: 'xinggui',
                    stockId: stockId
                })
            };
        }

        console.log(`興櫃數據查詢成功: ${stockId}, 數據類型: ${dataType}`);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ...result,
                success: true,
                source: 'xinggui',
                stockId: stockId,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('興櫃數據獲取錯誤:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: `興櫃數據獲取失敗: ${error.message}`,
                success: false,
                source: 'xinggui',
                stockId: stockId
            })
        };
    }
};

// 獲取興櫃公司基本資訊
async function fetchXingGuiBasicInfo(stockId) {
    try {
        const url = `https://www.tpex.org.tw/web/regular_emerging/raising/raising_result.php?l=zh-tw&o=json&stkno=${stockId}`;
        
        const response = await fetchWithTimeout(url, 10000);
        if (!response.ok) {
            throw new Error(`券商公會API失敗: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.aaData || !Array.isArray(data.aaData) || data.aaData.length === 0) {
            throw new Error('券商公會無此興櫃股票數據');
        }
        
        const stockInfo = data.aaData[0];
        
        return {
            name: stockInfo[1] || '未知',
            industry: stockInfo[2] || '未知',
            listingDate: stockInfo[3] || '未知',
            source: 'tpex_xinggui_basic'
        };
    } catch (error) {
        console.error('興櫃基本資訊查詢錯誤:', error);
        throw error;
    }
}

// 獲取興櫃公司財務數據
async function fetchXingGuiFinancials(stockId) {
    try {
        // 嘗試多個數據源
        const sources = [
            fetchMOPSFinancials(stockId),
            fetchTPEXFinancials(stockId)
        ];
        
        // 並行查詢，取第一個成功的結果
        const results = await Promise.allSettled(sources);
        
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value && hasValidFinancialData(result.value)) {
                console.log(`興櫃財務數據查詢成功，使用來源: ${result.value.source}`);
                return result.value;
            }
        }
        
        throw new Error('所有興櫃財務數據源都無有效數據');
        
    } catch (error) {
        console.error('興櫃財務數據查詢錯誤:', error);
        throw error;
    }
}

// 從公開資訊觀測站獲取財務數據
async function fetchMOPSFinancials(stockId) {
    const url = 'https://mops.twse.com.tw/mops/web/ajax_t100sb15';
    
    const formData = new URLSearchParams();
    formData.append('encodeURIComponent', '1');
    formData.append('step', '1');
    formData.append('firstin', '1');
    formData.append('off', '1');
    formData.append('co_id', stockId);
    formData.append('TYPEK', 'all');

    const response = await fetchWithTimeout(url, 15000, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`公開觀測站HTTP錯誤: ${response.status}`);
    }
    
    const html = await response.text();
    
    // 檢查HTML是否包含錯誤訊息
    if (html.includes('查無所需資料') || html.includes('無此公司代號')) {
        throw new Error('公開觀測站無此公司資料');
    }
    
    return parseMOPSFinancials(html, stockId);
}

// 從券商公會獲取財務數據
async function fetchTPEXFinancials(stockId) {
    const url = `https://www.tpex.org.tw/web/regular_emerging/raising/raising_result.php?l=zh-tw&o=json&stkno=${stockId}`;
    
    const response = await fetchWithTimeout(url, 10000);
    if (!response.ok) {
        throw new Error(`券商公會API失敗: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.aaData || !Array.isArray(data.aaData) || data.aaData.length === 0) {
        throw new Error('券商公會無此興櫃股票數據');
    }
    
    return parseTPEXFinancials(data, stockId);
}

// 解析公開觀測站HTML
function parseMOPSFinancials(html, stockId) {
    try {
        console.log('開始解析公開觀測站HTML...');
        
        const financials = {
            stockId: stockId,
            eps: extractEPS(html),
            revenue: extractRevenue(html),
            profit: extractProfit(html),
            roe: extractROE(html),
            grossMargin: extractGrossMargin(html),
            date: new Date().toISOString().split('T')[0],
            source: 'mops_xinggui'
        };
        
        console.log('公開觀測站解析結果:', financials);
        return financials;
    } catch (error) {
        console.error('公開觀測站HTML解析錯誤:', error);
        throw new Error(`公開觀測站數據解析失敗: ${error.message}`);
    }
}

// 解析券商公會數據
function parseTPEXFinancials(data, stockId) {
    const stockInfo = data.aaData[0];
    
    return {
        stockId: stockId,
        name: stockInfo[1] || '未知',
        industry: stockInfo[2] || '未知',
        listingDate: stockInfo[3] || '未知',
        source: 'tpex_xinggui_financials'
    };
}

// 提取EPS數據
function extractEPS(html) {
    // 在HTML中尋找EPS相關的表格或數據
    const epsMatch = html.match(/每股盈餘[^>]*>([\d.,]+)</) || 
                    html.match(/EPS[^>]*>([\d.,]+)</) ||
                    html.match(/基本每股盈餘[^>]*>([\d.,]+)</);
    
    if (epsMatch && epsMatch[1]) {
        const epsValue = parseFloat(epsMatch[1].replace(/,/g, ''));
        return isNaN(epsValue) ? null : epsValue;
    }
    
    return null;
}

// 提取營收數據
function extractRevenue(html) {
    // 在HTML中尋找營收相關的數據
    const revenueMatch = html.match(/營業收入[^>]*>([\d.,]+)</) ||
                       html.match(/營收[^>]*>([\d.,]+)</);
    
    if (revenueMatch && revenueMatch[1]) {
        const revenueValue = parseFloat(revenueMatch[1].replace(/,/g, ''));
        return isNaN(revenueValue) ? null : revenueValue;
    }
    
    return null;
}

// 提取淨利數據
function extractProfit(html) {
    // 在HTML中尋找淨利相關的數據
    const profitMatch = html.match(/本期淨利[^>]*>([\d.,-]+)</) ||
                      html.match(/稅後淨利[^>]*>([\d.,-]+)</) ||
                      html.match(/淨利[^>]*>([\d.,-]+)</);
    
    if (profitMatch && profitMatch[1]) {
        const profitValue = parseFloat(profitMatch[1].replace(/,/g, ''));
        return isNaN(profitValue) ? null : profitValue;
    }
    
    return null;
}

// 提取ROE數據
function extractROE(html) {
    // 在HTML中尋找ROE相關的數據
    const roeMatch = html.match(/股東權益報酬率[^>]*>([\d.,-]+)/) ||
                    html.match(/ROE[^>]*>([\d.,-]+)/);
    
    if (roeMatch && roeMatch[1]) {
        const roeValue = parseFloat(roeMatch[1].replace(/,/g, ''));
        return isNaN(roeValue) ? null : roeValue;
    }
    
    return null;
}

// 提取毛利率數據
function extractGrossMargin(html) {
    // 在HTML中尋找毛利率相關的數據
    const marginMatch = html.match(/毛利率[^>]*>([\d.,-]+)/) ||
                       html.match(/營業毛利[^>]*>([\d.,-]+)/);
    
    if (marginMatch && marginMatch[1]) {
        const marginValue = parseFloat(marginMatch[1].replace(/,/g, ''));
        return isNaN(marginValue) ? null : marginValue;
    }
    
    return null;
}

// 獲取興櫃公司股價
async function fetchXingGuiPrice(stockId) {
    try {
        const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&o=json&stkno=${stockId}`;
        
        const response = await fetchWithTimeout(url, 10000);
        if (!response.ok) {
            throw new Error(`興櫃股價API失敗: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.aaData || !Array.isArray(data.aaData) || data.aaData.length === 0) {
            throw new Error('興櫃無此股票股價數據');
        }
        
        const priceData = data.aaData[0];
        
        return {
            price: parseFloat(priceData[2]) || null,
            change: priceData[3] || null,
            changePercent: priceData[4] || null,
            volume: parseInt(priceData[1].replace(/,/g, '')) || null,
            date: priceData[0] || null,
            source: 'tpex_price'
        };
    } catch (error) {
        console.error('興櫃股價查詢錯誤:', error);
        throw error;
    }
}

// 帶超時的fetch函數
function fetchWithTimeout(url, timeout = 10000, options = {}) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Request timeout for ${url}`)), timeout)
        )
    ]);
}

// 檢查財務數據是否有效
function hasValidFinancialData(data) {
    return data.eps !== null || 
           data.revenue !== null || 
           data.profit !== null || 
           data.roe !== null ||
           data.grossMargin !== null;
}