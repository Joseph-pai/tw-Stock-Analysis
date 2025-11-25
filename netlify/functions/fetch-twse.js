const fetch = require('node-fetch');

// TWSE API 請求的超時時間
const TWSE_TIMEOUT = 15000; // 15 秒

/**
 * 輔助函數：從數據列表中找到第一個符合公司代號的條目
 */
const findItem = (dataList, stockCode, yearMonth) => {
    if (!dataList) return null;
    return dataList.find(item => 
        (String(item.Code) === stockCode || String(item['公司代號']) === stockCode) && 
        String(item['資料年月']).startsWith(yearMonth)
    );
};

/**
 * 輔助函數：從數據列表中找到最新的季度/年度數據 (綜合損益表)
 */
const findQuarterlyItem = (dataList, stockCode, year, quarterEndMonth) => {
    if (!dataList) return null;
    const targetDatePrefix = `${year}${quarterEndMonth}`;
    
    // 尋找最新的，且日期匹配的條目
    const relevantItems = dataList.filter(item => 
        (String(item.Code) === stockCode || String(item['公司代號']) === stockCode) && 
        String(item['資料日期']).startsWith(targetDatePrefix)
    );
    
    // 假設 TWSE API 返回的數據是按日期降序排列的，取第一個
    return relevantItems.length > 0 ? relevantItems[0] : null;
};

// 輔助函數：安全地解析數值
const safeParseFloat = (value) => {
    if (value === null || value === undefined || value === 'N/A') return NaN;
    const str = String(value).replace(/,/g, '');
    return parseFloat(str);
};

/**
 * 輔助函數：帶超時的 Fetch
 */
const fetchWithTimeout = async (url, timeout) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const { type, stockCode, year, quarter } = event.queryStringParameters;

    // ----------------------------------------------------
    // ⚠️ 核心修正: 處理帶參數的季度數據請求 (type=quarterly_specific) ⚠️
    // ----------------------------------------------------
    if (type === 'quarterly_specific' && stockCode && year && quarter) {
        
        const qMap = { 'Q1': '03', 'Q2': '06', 'Q3': '09', 'Q4': '12' };
        const quarterEndMonth = qMap[quarter];
        const prevYear = parseInt(year) - 1;
        
        if (!quarterEndMonth) {
             return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid quarter' }) };
        }
        
        try {
            // 2. 請求兩個主要 API 數據源 (使用帶超時的 fetch)
            const [ciRes, monthlyRes] = await Promise.all([
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', TWSE_TIMEOUT), // 綜合損益表
                fetchWithTimeout('https://openapi.twse.com.tw/v1/opendata/t187ap05_L', TWSE_TIMEOUT)  // 月營收彙總表
            ]);
            
            const ciData = await ciRes.json();
            const monthlyData = await monthlyRes.json();

            // 3. 獲取本期和去年同期的綜合損益表數據
            const currentItem = findQuarterlyItem(ciData, stockCode, year, quarterEndMonth);
            const prevItem = findQuarterlyItem(ciData, stockCode, prevYear, quarterEndMonth);

            // 4. 獲取月營收數據 (用於計算季營收增長率)
            const getQuarterlyRevenue = (targetYear, targetQuarter) => {
                const startMonth = (parseInt(targetQuarter.substring(1)) - 1) * 3 + 1;
                const monthArr = [startMonth, startMonth + 1, startMonth + 2].map(m => String(m).padStart(2, '0'));
                
                let totalRevenue = 0;
                let foundCount = 0;

                for (const month of monthArr) {
                    const yearMonth = targetYear + month;
                    const monthlyItem = findItem(monthlyData, stockCode, yearMonth);
                    
                    if (monthlyItem) {
                        const revenue = safeParseFloat(monthlyItem['營業收入-當月營收']);
                        if (!isNaN(revenue)) {
                            totalRevenue += revenue;
                            foundCount++;
                        }
                    }
                }
                
                // 必須找到三個月的數據才視為有效
                return foundCount === 3 ? totalRevenue : NaN;
            };

            const currentQuarterRevenue = getQuarterlyRevenue(year, quarter);
            const prevQuarterRevenue = getQuarterlyRevenue(prevYear, quarter); 

            // 5. 執行人工計算 (季營收增長率)
            let quarterlyRevenueGrowth = 'N/A';
            if (!isNaN(currentQuarterRevenue) && !isNaN(prevQuarterRevenue) && prevQuarterRevenue !== 0) {
                 const growth = ((currentQuarterRevenue - prevQuarterRevenue) / prevQuarterRevenue) * 100;
                 quarterlyRevenueGrowth = growth.toFixed(2);
            }
            
            // 6. 整合結果
            const resultData = {
                StockCode: stockCode,
                Year: year,
                Quarter: quarter,
                // 從綜合損益表獲取 EPS/ROE/毛利率
                EPS: currentItem ? safeParseFloat(currentItem['基本每股盈餘']) : 'N/A',
                ROE: currentItem ? safeParseFloat(currentItem['股東權益報酬率'] || currentItem['稅後淨利']) : 'N/A', 
                GrossMarginRate: currentItem ? safeParseFloat(currentItem['營業毛利率']) : 'N/A', 
                
                // 核心人工計算結果
                QuarterlyRevenueGrowth: quarterlyRevenueGrowth, 
                
                // 額外資訊
                CurrentQuarterRevenue: isNaN(currentQuarterRevenue) ? 'N/A' : currentQuarterRevenue,
                PreviousQuarterRevenue: isNaN(prevQuarterRevenue) ? 'N/A' : prevQuarterRevenue,
            };

            return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok', data: resultData }) };

        } catch (error) {
            console.error(`Quarterly specific fetch error for ${stockCode}:`, error);
            // ⚠️ 失敗時回傳錯誤訊息，讓前端可以記錄到日誌中
            return { 
                statusCode: 500, 
                headers, 
                body: JSON.stringify({ 
                    error: `伺服器計算或請求失敗: ${error.message}`, 
                    detail: `請檢查 Netlify Functions 日誌。可能是 TWSE API 超時或無該期間數據。`
                }) 
            };
        }
    }
    // ----------------------------------------------------
    // 原始邏輯：處理不帶參數的請求 (stocks, quarterly, annual, monthly)
    // ----------------------------------------------------

    const sources = {
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd', 
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins',
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L' 
        ],
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L',
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'
        ],
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if' 
        ],
        stocks: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap03_L' 
        ]
    };

    const targetUrls = sources[type];

    if (!targetUrls) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type or missing parameters' }) };
    }

    try {
        const requests = targetUrls.map(url => 
            fetchWithTimeout(url, TWSE_TIMEOUT) // 使用帶超時的 fetch
        );
        const responses = await Promise.all(requests);
        const data = await Promise.all(responses.map(res => res.json()));

        const combinedData = data.flatMap(d => d.data || d); 

        return { statusCode: 200, headers, body: JSON.stringify(combinedData) };

    } catch (error) {
        console.error(`TWSE bulk fetch error for type ${type}:`, error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `TWSE API fetch failed: ${error.message}` }) };
    }
};