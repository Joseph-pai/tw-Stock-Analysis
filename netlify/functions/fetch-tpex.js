const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // 设置CORS头
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // 获取参数
    const stockId = event.queryStringParameters?.stock_id;
    const dataType = event.queryStringParameters?.data_type || 'financials'; // financials, price, info

    if (!stockId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '缺少股票代码参数' })
        };
    }

    console.log(`TPEx API请求: ${stockId}, 类型: ${dataType}`);

    try {
        let result;
        
        switch (dataType) {
            case 'financials':
                result = await fetchTPExFinancials(stockId);
                break;
            case 'price':
                result = await fetchTPExPrice(stockId);
                break;
            case 'info':
                result = await fetchTPExCompanyInfo(stockId);
                break;
            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: '不支持的数据类型: ' + dataType })
                };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('TPEx API错误:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: '获取TPEx数据失败',
                details: error.message,
                stock_id: stockId 
            })
        };
    }
};

// 获取興櫃公司财务数据
async function fetchTPExFinancials(stockId) {
    console.log(`获取興櫃财务数据: ${stockId}`);
    
    try {
        // 注意：TPEx API可能需要具体查询实际的公开API端点
        // 这里使用模拟数据展示结构，需要根据实际API调整
        
        // 模拟API响应 - 实际使用时替换为真实API调用
        const mockFinancialData = {
            company_id: stockId,
            company_name: `興櫃公司 ${stockId}`,
            report_date: new Date().toISOString().split('T')[0],
            
            // 每股盈余 (EPS) 数据
            eps_data: {
                current_quarter: getRandomEPS(), // 当前季度
                q1: getRandomEPS(), // 第一季度
                q2: getRandomEPS(), // 第二季度
                q3: getRandomEPS(), // 第三季度
                q4: getRandomEPS(), // 第四季度
                year_total: getRandomEPS() * 4, // 年度累计
                last_year: getRandomEPS() * 4, // 去年同期
                growth_rate: Math.random() > 0.5 ? 15.5 : -8.2 // 成长率
            },
            
            // 股东权益报酬率 (ROE)
            roe_data: {
                current: (Math.random() * 30 + 5).toFixed(2), // 当前ROE
                average: (Math.random() * 25 + 8).toFixed(2), // 平均ROE
                industry_average: '12.5' // 行业平均
            },
            
            // 营收数据
            revenue_data: {
                current_month: (Math.random() * 1000 + 500).toFixed(2), // 当月营收
                month_growth: (Math.random() * 50 - 10).toFixed(2), // 月增率
                year_growth: (Math.random() * 100 - 20).toFixed(2), // 年增率
                accumulated_year: (Math.random() * 5000 + 2000).toFixed(2) // 年度累计
            },
            
            // 毛利率
            gross_margin_data: {
                current: (Math.random() * 60 + 10).toFixed(2), // 当前毛利率
                last_quarter: (Math.random() * 60 + 10).toFixed(2), // 上季毛利率
                last_year: (Math.random() * 60 + 10).toFixed(2) // 去年同期
            },
            
            // 其他财务指标
            other_indicators: {
                debt_ratio: (Math.random() * 50 + 20).toFixed(2), // 负债比率
                current_ratio: (Math.random() * 3 + 1).toFixed(2), // 流动比率
                quick_ratio: (Math.random() * 2 + 0.5).toFixed(2), // 速动比率
                per: (Math.random() * 30 + 8).toFixed(2), // 本益比
                pbr: (Math.random() * 3 + 0.8).toFixed(2) // 股价净值比
            },
            
            // 数据来源说明
            source: 'TPEx (台灣證券交易所興櫃公司)',
            last_updated: new Date().toISOString(),
            disclaimer: '此数据仅供参考，实际数据以TPEx官方公告为准'
        };

        // 转换为统一格式（与上市公司格式兼容）
        const unifiedFormat = transformToUnifiedFormat(mockFinancialData, stockId);
        
        return {
            success: true,
            data: unifiedFormat,
            raw_data: mockFinancialData,
            source: 'TPEx',
            note: '此为模拟数据，需要配置真实TPEx API端点'
        };

    } catch (error) {
        console.error('获取TPEx财务数据失败:', error);
        
        // 返回降级数据
        return getFallbackFinancialData(stockId);
    }
}

// 获取興櫃公司股价数据
async function fetchTPExPrice(stockId) {
    console.log(`获取興櫃股价数据: ${stockId}`);
    
    try {
        // 实际API调用 - 需要根据TPEx实际API调整
        // 这里使用Yahoo Finance作为备选（興櫃股票代码通常加.TWO）
        const yahooSymbol = `${stockId}.TWO`;
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1mo`;
        
        const response = await fetch(yahooUrl);
        if (!response.ok) throw new Error(`Yahoo API错误: ${response.status}`);
        
        const data = await response.json();
        
        if (data?.chart?.result?.[0]) {
            return {
                success: true,
                symbol: yahooSymbol,
                price_data: data.chart.result[0],
                source: 'Yahoo Finance (TPEx)'
            };
        } else {
            throw new Error('无效的股价数据');
        }
        
    } catch (error) {
        console.error('获取TPEx股价失败:', error);
        
        // 返回模拟数据
        return getMockPriceData(stockId);
    }
}

// 获取興櫃公司基本信息
async function fetchTPExCompanyInfo(stockId) {
    console.log(`获取興櫃公司信息: ${stockId}`);
    
    try {
        // 模拟公司信息 - 实际需要调用TPEx API
        const mockInfo = {
            stock_id: stockId,
            company_name: `興櫃科技股份有限公司 ${stockId}`,
            industry: getRandomIndustry(),
            established_date: '2020-01-15',
            listing_date: '2023-06-30',
            capital: (Math.random() * 500 + 100).toFixed(0) + '百万',
            chairman: '張大明',
            headquarters: '台北市內湖區科技園區',
            business_scope: '半導體設計、軟體開發、技術服務',
            website: 'https://example.com',
            employees: Math.floor(Math.random() * 300 + 50),
            market_segment: '興櫃市場'
        };
        
        return {
            success: true,
            data: mockInfo,
            source: 'TPEx',
            note: '此为模拟数据'
        };
        
    } catch (error) {
        console.error('获取公司信息失败:', error);
        return {
            success: false,
            error: '无法获取公司信息',
            stock_id: stockId
        };
    }
}

// ===================== 辅助函数 =====================

// 转换TPEx数据为统一格式
function transformToUnifiedFormat(tpexData, stockId) {
    // 统一格式（与fetch-twse.js返回的格式一致）
    return {
        eps: {
            quarters: {
                'Q1': parseFloat(tpexData.eps_data.q1 || 0),
                'Q2': parseFloat(tpexData.eps_data.q2 || 0),
                'Q3': parseFloat(tpexData.eps_data.q3 || 0),
                'Q4': parseFloat(tpexData.eps_data.q4 || 0)
            },
            year: parseFloat(tpexData.eps_data.year_total || 0)
        },
        roe: {
            quarters: {
                'Q1': parseFloat(tpexData.roe_data.current || 0),
                'Q2': parseFloat(tpexData.roe_data.current || 0),
                'Q3': parseFloat(tpexData.roe_data.current || 0),
                'Q4': parseFloat(tpexData.roe_data.current || 0)
            },
            year: parseFloat(tpexData.roe_data.current || 0)
        },
        revenueGrowth: {
            months: {
                // 模拟月度成长数据
                '11311': parseFloat(tpexData.revenue_data.month_growth || 0),
                '11312': parseFloat(tpexData.revenue_data.month_growth || 0) + 2.5,
                '11401': parseFloat(tpexData.revenue_data.month_growth || 0) + 1.8,
                '11402': parseFloat(tpexData.revenue_data.month_growth || 0) - 0.5
            },
            quarters: {
                'Q1': parseFloat(tpexData.revenue_data.year_growth || 0),
                'Q2': parseFloat(tpexData.revenue_data.year_growth || 0) + 3.2,
                'Q3': parseFloat(tpexData.revenue_data.year_growth || 0) - 1.8,
                'Q4': parseFloat(tpexData.revenue_data.year_growth || 0) + 5.6
            },
            year: parseFloat(tpexData.revenue_data.year_growth || 0)
        },
        profitMargin: {
            quarters: {
                'Q1': parseFloat(tpexData.gross_margin_data.current || 0),
                'Q2': parseFloat(tpexData.gross_margin_data.current || 0) + 1.2,
                'Q3': parseFloat(tpexData.gross_margin_data.current || 0) - 0.8,
                'Q4': parseFloat(tpexData.gross_margin_data.current || 0) + 2.3
            },
            year: parseFloat(tpexData.gross_margin_data.current || 0)
        },
        _metadata: {
            source: 'TPEx',
            stock_id: stockId,
            company_name: tpexData.company_name,
            transform_date: new Date().toISOString(),
            original_data_structure: 'tpex'
        }
    };
}

// 获取降级财务数据（当API失败时使用）
function getFallbackFinancialData(stockId) {
    console.log(`使用降级财务数据: ${stockId}`);
    
    return {
        success: true,
        data: {
            eps: {
                quarters: { 'Q1': 0.5, 'Q2': 0.8, 'Q3': 1.2, 'Q4': 1.5 },
                year: 4.0
            },
            roe: {
                quarters: { 'Q1': 8.5, 'Q2': 9.2, 'Q3': 10.1, 'Q4': 11.3 },
                year: 9.8
            },
            revenueGrowth: {
                months: {},
                quarters: { 'Q1': 12.5, 'Q2': 15.3, 'Q3': 18.7, 'Q4': 22.1 },
                year: 17.2
            },
            profitMargin: {
                quarters: { 'Q1': 25.3, 'Q2': 26.8, 'Q3': 28.1, 'Q4': 29.5 },
                year: 27.4
            },
            _metadata: {
                source: 'fallback',
                stock_id: stockId,
                note: 'TPEx API暂时不可用，使用默认数据'
            }
        },
        warning: 'TPEx API暂时不可用，显示默认数据供参考'
    };
}

// 获取模拟股价数据
function getMockPriceData(stockId) {
    const now = Date.now() / 1000;
    const days = 30;
    const timestamps = [];
    const closes = [];
    
    let basePrice = 50 + Math.random() * 100;
    
    for (let i = days; i >= 0; i--) {
        timestamps.push(now - (i * 86400));
        // 模拟股价波动
        const change = (Math.random() - 0.5) * 5;
        basePrice = Math.max(10, basePrice + change);
        closes.push(parseFloat(basePrice.toFixed(2)));
    }
    
    return {
        success: true,
        symbol: stockId,
        price_data: {
            timestamp: timestamps,
            indicators: {
                quote: [{
                    close: closes,
                    open: closes.map(c => c * 0.99),
                    high: closes.map(c => c * 1.02),
                    low: closes.map(c => c * 0.98),
                    volume: closes.map(() => Math.floor(Math.random() * 1000000) + 500000)
                }]
            },
            meta: {
                currency: 'TWD',
                symbol: stockId,
                exchangeName: 'TPEx',
                instrumentType: 'EQUITY',
                timezone: 'Asia/Taipei'
            }
        },
        source: 'mock',
        note: '模拟股价数据'
    };
}

// 随机EPS生成
function getRandomEPS() {
    return parseFloat((Math.random() * 3 + 0.1).toFixed(2));
}

// 随机行业
function getRandomIndustry() {
    const industries = [
        '半导体业', '电子零组件业', '电脑及週邊設備業',
        '通信網路業', '光電業', '生技醫療業',
        '軟體服務業', '文化創意業', '電子商務業'
    ];
    return industries[Math.floor(Math.random() * industries.length)];
}