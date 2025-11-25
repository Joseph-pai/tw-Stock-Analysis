const fetch = require('node-fetch');

/**
 * 輔助函數：從數據列表中找到第一個符合公司代號的條目
 * @param {Array} dataList - TWSE API 返回的數據列表
 * @param {string} stockCode - 股票代號
 * @param {string} yearMonth - 年月字串 (YYYYMM)
 * @returns {Object|null} 找到的數據條目
 */
const findItem = (dataList, stockCode, yearMonth) => {
    if (!dataList) return null;
    return dataList.find(item => 
        (String(item.Code) === stockCode || String(item['公司代號']) === stockCode) && 
        String(item['資料年月']).startsWith(yearMonth)
    );
};

/**
 * 輔助函數：從數據列表中找到最新的季度/年度數據
 * @param {Array} dataList - TWSE API 返回的數據列表
 * @param {string} stockCode - 股票代號
 * @param {string} quarterEndMonth - 季度截止月份 (03, 06, 09, 12)
 * @returns {Object|null} 找到的數據條目
 */
const findQuarterlyItem = (dataList, stockCode, year, quarterEndMonth) => {
    if (!dataList) return null;
    const targetDate = `${year}${quarterEndMonth}`;
    
    // 尋找最新的，且日期匹配的條目
    const relevantItems = dataList.filter(item => 
        (String(item.Code) === stockCode || String(item['公司代號']) === stockCode) && 
        String(item['資料日期']).startsWith(targetDate)
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

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

    const { type, stockCode, year, quarter } = event.queryStringParameters;

    const sources = {
        // [季度資料] 原始的 quarterly API 集合 (前端的 fetchFullTWSEFinancials 仍會呼叫)
        quarterly: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci', // 綜合損益表
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh', // 金控
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd', // 銀行
            'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins',// 保險
            'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'     // 月營收
        ],
        // [年度/分析資料]
        annual: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap17_L', // 財務比率分析
            'https://openapi.twse.com.tw/v1/opendata/t187ap46_L'
        ],
        // [月營收資料]
        monthly: [
            'https://openapi.twse.com.tw/v1/opendata/t05st10_if' // 月營收彙總表 (較新)
        ],
        // [股票清單]
        stocks: [
            'https://openapi.twse.com.tw/v1/opendata/t187ap03_L' // 上市公司基本資料
        ]
    };

    // ----------------------------------------------------
    // ⚠️ 核心修正: 處理帶參數的季度數據請求 (type=quarterly_specific) ⚠️
    // ----------------------------------------------------
    if (type === 'quarterly_specific' && stockCode && year && quarter) {
        
        // 1. 定義季度截止月份和去年同期季度截止月份
        const qMap = { 'Q1': '03', 'Q2': '06', 'Q3': '09', 'Q4': '12' };
        const quarterEndMonth = qMap[quarter];
        const prevYear = parseInt(year) - 1;
        
        if (!quarterEndMonth) {
             return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid quarter' }) };
        }
        
        try {
            // 2. 請求兩個主要 API 數據源
            const [ciRes, monthlyRes] = await Promise.all([
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci'), // 綜合損益表
                fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L')  // 月營收彙總表
            ]);
            
            if (!ciRes.ok || !monthlyRes.ok) {
                 return { statusCode: ciRes.status || 500, headers, body: JSON.stringify({ error: 'Failed to fetch TWSE raw data' }) };
            }

            const ciData = await ciRes.json();
            const monthlyData = await monthlyRes.json();

            // 3. 獲取本期和去年同期的數據
            const currentItem = findQuarterlyItem(ciData, stockCode, year, quarterEndMonth);
            const prevItem = findQuarterlyItem(ciData, stockCode, prevYear, quarterEndMonth);

            // 4. 獲取月營收數據 (用於計算季營收增長率)
            // 季度營收是該季度三個月的營收總和 (例如 Q3 = 07+08+09)
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

            // 5. 執行人工計算
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
                ROE: currentItem ? safeParseFloat(currentItem['股東權益報酬率']) : 'N/A', // 假設此 API 有 ROE
                GrossMarginRate: currentItem ? safeParseFloat(currentItem['營業毛利率']) : 'N/A', // 假設此 API 有毛利率
                
                // 核心人工計算結果
                QuarterlyRevenueGrowth: quarterlyRevenueGrowth, 
                
                // 額外資訊（可選）
                CurrentQuarterRevenue: isNaN(currentQuarterRevenue) ? 'N/A' : currentQuarterRevenue,
                PreviousQuarterRevenue: isNaN(prevQuarterRevenue) ? 'N/A' : prevQuarterRevenue,
            };

            return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok', data: resultData }) };

        } catch (error) {
            console.error('Quarterly specific fetch error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: `Server calculation failed: ${error.message}` }) };
        }
    }
    // ----------------------------------------------------
    // 原始邏輯：處理不帶參數的請求 (stocks, quarterly, annual, monthly)
    // ----------------------------------------------------

    const targetUrls = sources[type];

    if (!targetUrls) {
        // 如果不是帶參數的季度請求，也不是標準 type，則返回錯誤
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type or missing parameters' }) };
    }

    try {
        const requests = targetUrls.map(url => 
            fetch(url, { signal: AbortSignal.timeout(10000) }) // 設置 10 秒超時
        );
        const responses = await Promise.all(requests);
        const data = await Promise.all(responses.map(res => res.json()));

        // 將所有數據合併成一個大陣列
        const combinedData = data.flatMap(d => d.data || d); 

        return { statusCode: 200, headers, body: JSON.stringify(combinedData) };

    } catch (error) {
        console.error(`TWSE bulk fetch error for type ${type}:`, error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `TWSE API fetch failed: ${error.message}` }) };
    }
};