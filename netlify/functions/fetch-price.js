const fetch = require('node-fetch');

/**
 * Netlify Function 專用於獲取 Yahoo Finance 的股價 (Chart) 數據
 * 支援台灣上市公司(.TW)和興櫃公司(.TWO)
 */
exports.handler = async (event, context) => {
    // 獲取前端傳入的股票代碼 (e.g., id=2330.TW or ^TWII)
    const symbol = event.queryStringParameters.id; 
    const market = event.queryStringParameters.market || 'TWSE';

    if (!symbol) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing stock symbol (id parameter)' }),
        };
    }

    let yahooSymbol = symbol;
    
    // 如果傳入的是純數字股票代碼，自動添加正確的後綴
    if (/^\d+$/.test(symbol)) {
        // 判斷是上市公司還是興櫃公司
        if (market === 'TPEx') {
            // 興櫃公司使用 .TWO
            yahooSymbol = `${symbol}.TWO`;
        } else {
            // 上市公司使用 .TW
            yahooSymbol = `${symbol}.TW`;
        }
    }
    
    console.log(`股票代碼轉換: ${symbol} (市場: ${market}) -> ${yahooSymbol}`);

    // Yahoo Finance Chart API (v8)
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1y`;

    try {
        const response = await fetch(yahooUrl);
        
        if (!response.ok) {
            // 如果第一個後綴失敗，嘗試另一個後綴
            if (market === 'TPEx' && yahooSymbol.endsWith('.TWO')) {
                // 如果是興櫃公司但.TWO失敗，嘗試.TW
                const altYahooSymbol = `${symbol}.TW`;
                console.log(`嘗試替代代碼: ${altYahooSymbol}`);
                
                const altResponse = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${altYahooSymbol}?interval=1d&range=1y`);
                
                if (altResponse.ok) {
                    const altData = await altResponse.json();
                    
                    if (altData?.chart?.result?.[0]) {
                        return {
                            statusCode: 200,
                            body: JSON.stringify(altData),
                        };
                    }
                }
            } else if (market === 'TWSE' && yahooSymbol.endsWith('.TW')) {
                // 如果是上市公司但.TW失敗，嘗試.TWO
                const altYahooSymbol = `${symbol}.TWO`;
                console.log(`嘗試替代代碼: ${altYahooSymbol}`);
                
                const altResponse = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${altYahooSymbol}?interval=1d&range=1y`);
                
                if (altResponse.ok) {
                    const altData = await altResponse.json();
                    
                    if (altData?.chart?.result?.[0]) {
                        return {
                            statusCode: 200,
                            body: JSON.stringify(altData),
                        };
                    }
                }
            }
            
            return {
                statusCode: response.status,
                body: JSON.stringify({ 
                    error: `Yahoo API response error: ${response.statusText}`,
                    symbol: yahooSymbol,
                    market: market
                }),
            };
        }

        const data = await response.json();
        
        // 檢查數據結構是否正確
        if (data?.chart?.result?.[0]) {
            return {
                statusCode: 200,
                // 返回完整的 Yahoo Chart 數據結構
                body: JSON.stringify(data),
            };
        } else {
             return {
                statusCode: 404,
                body: JSON.stringify({ 
                    error: 'Yahoo Finance did not return price data.',
                    symbol: yahooSymbol
                }),
            };
        }

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: `Internal server error: ${error.message}`,
                symbol: yahooSymbol
            }),
        };
    }
};