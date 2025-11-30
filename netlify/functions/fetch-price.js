const fetch = require('node-fetch');

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
        
        // 三層備援邏輯
        try {
            result = await fetchFromFinMind(symbol);
            source = 'finmind';
        } catch (error) {
            console.log('FinMind failed, trying TWSE...');
            try {
                result = await fetchFromTWSE(symbol);
                source = 'twse';
            } catch (error) {
                console.log('TWSE failed, trying TPEx...');
                try {
                    result = await fetchFromTPEx(symbol);
                    source = 'tpex';
                } catch (error) {
                    console.log('TPEx failed, trying Yahoo...');
                    result = await fetchFromYahoo(symbol);
                    source = 'yahoo';
                }
            }
        }

        // 統一返回格式，兼容前端預期
        const compatibleResult = {
            chart: {
                result: [{
                    meta: {
                        symbol: result.stockId,
                        regularMarketPrice: result.price,
                        previousClose: result.price - result.change,
                        regularMarketVolume: result.volume,
                        regularMarketTime: new Date(result.date).getTime() / 1000
                    },
                    timestamp: result.historicalData ? 
                        result.historicalData.map(d => new Date(d.date).getTime() / 1000) : 
                        [new Date(result.date).getTime() / 1000],
                    indicators: {
                        quote: [{
                            close: result.historicalData ? 
                                result.historicalData.map(d => parseFloat(d.close)) : 
                                [result.price],
                            volume: result.historicalData ? 
                                result.historicalData.map(d => d.Trading_volume || d.volume) : 
                                [result.volume]
                        }]
                    }
                }]
            },
            unified: result,
            source: source
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(compatibleResult)
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

// 1. FinMind 數據源 - 修復：獲取1年歷史數據
async function fetchFromFinMind(stockId) {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockId}&start_date=${getDate(-365)}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`FinMind API失敗: ${response.status}`);
    
    const data = await response.json();
    if (!data.data || data.data.length === 0) throw new Error('FinMind無數據');
    
    const latest = data.data[data.data.length - 1];
    return {
        stockId: stockId,
        price: parseFloat(latest.close),
        change: parseFloat(latest.change),
        changePercent: ((latest.change / (latest.close - latest.change)) * 100).toFixed(2),
        volume: latest.Trading_volume,
        date: latest.date,
        historicalData: data.data, // 新增完整的歷史數據
        source: 'finmind'
    };
}

// 2. TWSE 數據源
async function fetchFromTWSE(stockId) {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${stockId}.tw|otc_${stockId}.tw`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TWSE API失敗: ${response.status}`);
    
    const data = await response.json();
    if (!data.msgArray || data.msgArray.length === 0) throw new Error('TWSE無數據');
    
    const stock = data.msgArray[0];
    const price = parseFloat(stock.z);
    const previousClose = parseFloat(stock.y);
    
    return {
        stockId: stockId,
        price: price,
        change: price - previousClose,
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
    const price = parseFloat(priceData[2]);
    const change = parseFloat(priceData[3]);
    
    return {
        stockId: stockId,
        price: price,
        change: change,
        changePercent: priceData[4],
        volume: parseInt(priceData[1].replace(/,/g, '')),
        date: priceData[0],
        source: 'tpex'
    };
}

// 4. Yahoo Finance 數據源
async function fetchFromYahoo(symbol) {
    const formattedSymbol = symbol.includes('.') ? symbol : `${symbol}.TW`;
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${formattedSymbol}?interval=1d&range=1y`; // 改為1年範圍
    
    const response = await fetch(yahooUrl);
    if (!response.ok) throw new Error(`Yahoo API失敗: ${response.status}`);
    
    const data = await response.json();
    if (!data?.chart?.result?.[0]) throw new Error('Yahoo無數據');
    
    const result = data.chart.result[0];
    const price = result.meta.regularMarketPrice;
    const previousClose = result.meta.previousClose;
    
    // 提取歷史數據
    const historicalData = result.timestamp.map((timestamp, index) => ({
        date: new Date(timestamp * 1000).toISOString().split('T')[0],
        close: result.indicators.quote[0].close[index],
        volume: result.indicators.quote[0].volume[index]
    }));
    
    return {
        stockId: symbol,
        price: price,
        change: price - previousClose,
        changePercent: ((price - previousClose) / previousClose * 100).toFixed(2),
        volume: result.meta.regularMarketVolume,
        date: new Date(result.meta.regularMarketTime * 1000).toISOString().split('T')[0],
        historicalData: historicalData,
        source: 'yahoo'
    };
}

function getDate(daysOffset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return date.toISOString().split('T')[0];
}