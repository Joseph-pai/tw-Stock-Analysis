const fetch = require('node-fetch');

/**
 * Netlify Function - 三層備援股價獲取系統
 * 1. FinMind (主要)
 * 2. TWSE (備援1) 
 * 3. TPEx 興櫃 (備援2)
 * 4. Yahoo Finance (最後備援)
 */
exports.handler = async (event, context) => {
    const symbol = event.queryStringParameters.id;
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };

    if (!symbol) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing stock symbol' }) };
    }

    try {
        let result;
        let source;
        
        // 1. 先嘗試 FinMind
        try {
            result = await fetchFromFinMind(symbol);
            source = 'finmind';
        } catch (error) {
            console.log('FinMind failed, trying TWSE...');
            
            // 2. 嘗試 TWSE
            try {
                result = await fetchFromTWSE(symbol);
                source = 'twse';
            } catch (error) {
                console.log('TWSE failed, trying TPEx...');
                
                // 3. 嘗試 TPEx (興櫃)
                try {
                    result = await fetchFromTPEx(symbol);
                    source = 'tpex';
                } catch (error) {
                    console.log('TPEx failed, trying Yahoo...');
                    
                    // 4. 最後嘗試 Yahoo Finance
                    result = await fetchFromYahoo(symbol);
                    source = 'yahoo';
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ...result,
                source: source
            })
        };

    } catch (error) {
        console.error('All price APIs failed:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: '所有股價數據源都失敗',
                details: error.message
            })
        };
    }
};

// 1. FinMind 數據源
async function fetchFromFinMind(stockId) {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockId}&start_date=${getDate(-30)}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`FinMind API失敗: ${response.status}`);
    
    const data = await response.json();
    if (!data.data || data.data.length === 0) throw new Error('FinMind無數據');
    
    const latest = data.data[data.data.length - 1];
    return {
        stockId: stockId,
        price: latest.close,
        change: latest.change,
        changePercent: ((latest.change / (latest.close - latest.change)) * 100).toFixed(2),
        volume: latest.Trading_volume,
        date: latest.date,
        source: 'finmind'
    };
}

// 2. TWSE 數據源
async function fetchFromTWSE(stockId) {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${stockId}.tw`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TWSE API失敗: ${response.status}`);
    
    const data = await response.json();
    if (!data.msgArray || data.msgArray.length === 0) throw new Error('TWSE無數據');
    
    const stock = data.msgArray[0];
    return {
        stockId: stockId,
        price: parseFloat(stock.z),
        change: parseFloat(stock.z) - parseFloat(stock.y),
        changePercent: stock.pz,
        volume: parseInt(stock.v),
        date: stock.d,
        source: 'twse'
    };
}

// 3. TPEx 興櫃數據源
async function fetchFromTPEx(stockId) {
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&o=json&stkno=${stockId}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TPEx API失敗: ${response.status}`);
    
    const data = await response.json();
    if (!data.aaData || data.aaData.length === 0) throw new Error('TPEx無數據');
    
    const priceData = data.aaData[0];
    return {
        stockId: stockId,
        price: parseFloat(priceData[2]),
        change: priceData[3],
        changePercent: priceData[4],
        volume: parseInt(priceData[1]),
        date: priceData[0],
        source: 'tpex'
    };
}

// 4. Yahoo Finance 數據源 (保持原有邏輯)
async function fetchFromYahoo(symbol) {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    
    const response = await fetch(yahooUrl);
    if (!response.ok) throw new Error(`Yahoo API失敗: ${response.status}`);
    
    const data = await response.json();
    if (!data?.chart?.result?.[0]) throw new Error('Yahoo無數據');
    
    const result = data.chart.result[0];
    const price = result.meta.regularMarketPrice;
    const previousClose = result.meta.previousClose;
    
    return {
        stockId: symbol,
        price: price,
        change: price - previousClose,
        changePercent: ((price - previousClose) / previousClose * 100).toFixed(2),
        volume: result.meta.regularMarketVolume,
        date: new Date(result.meta.regularMarketTime * 1000).toISOString().split('T')[0],
        source: 'yahoo'
    };
}

// 工具函數：取得日期
function getDate(daysOffset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return date.toISOString().split('T')[0];
}