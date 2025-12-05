const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // 设置CORS头
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS, POST'
    };

    // 处理预检请求
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // 获取股票代码
    const stockCode = event.queryStringParameters?.stock_code || 
                     (event.body ? JSON.parse(event.body).stock_code : null);

    if (!stockCode) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '缺少股票代码参数' })
        };
    }

    console.log(`开始检测公司类型: ${stockCode}`);

    try {
        let result = {
            stock_code: stockCode,
            type: 'not_found',
            stock_name: '',
            source: '',
            suggestions: []
        };

        // 1. 先尝试查询上市公司（TWSE）
        console.log(`尝试查询上市公司 (TWSE): ${stockCode}`);
        const listedResult = await checkListedCompany(stockCode);
        
        if (listedResult.found) {
            console.log(`✅ 找到上市公司: ${listedResult.stock_name}`);
            result.type = 'listed';
            result.stock_name = listedResult.stock_name;
            result.source = 'TWSE';
            result.suggestions = listedResult.suggestions || [];
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(result)
            };
        }

        // 2. 再尝试查询興櫃公司（TPEx）
        console.log(`尝试查询興櫃公司 (TPEx): ${stockCode}`);
        const emergingResult = await checkEmergingCompany(stockCode);
        
        if (emergingResult.found) {
            console.log(`✅ 找到興櫃公司: ${emergingResult.stock_name}`);
            result.type = 'emerging';
            result.stock_name = emergingResult.stock_name;
            result.source = 'TPEx';
            result.suggestions = emergingResult.suggestions || [];
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(result)
            };
        }

        // 3. 如果都没找到，提供建议
        console.log(`❌ 未找到公司: ${stockCode}`);
        result.suggestions = generateSuggestions(stockCode);
        
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('检测公司类型错误:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: '检测公司类型失败',
                details: error.message,
                stock_code: stockCode 
            })
        };
    }
};

// 检查是否为上市公司（TWSE）
async function checkListedCompany(stockCode) {
    try {
        // 方法1: 通过TWSE API查询
        const twseUrl = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
        const response = await fetch(twseUrl, { timeout: 10000 });
        
        if (!response.ok) {
            console.log('TWSE API请求失败，尝试方法2');
            // 方法2: 通过代码模式判断（上市公司通常是4位数字）
            if (/^\d{4}$/.test(stockCode)) {
                return { 
                    found: true, 
                    stock_name: `上市公司 ${stockCode}`,
                    suggestions: ['尝试通过FinMind获取数据']
                };
            }
            return { found: false };
        }

        const data = await response.json();
        
        // 查找匹配的股票
        const foundStock = data.find(item => 
            item['公司代號'] === stockCode || 
            item['公司簡稱'] === stockCode ||
            item['公司名稱'] === stockCode
        );

        if (foundStock) {
            return {
                found: true,
                stock_name: foundStock['公司名稱'] || foundStock['公司簡稱'],
                stock_id: foundStock['公司代號'],
                industry: foundStock['產業別']
            };
        }

        return { found: false };
    } catch (error) {
        console.log('检查上市公司失败:', error.message);
        return { found: false };
    }
}

// 检查是否为興櫃公司（TPEx）
async function checkEmergingCompany(stockCode) {
    try {
        // 方法1: 通过TPEx API查询
        const tpexUrl = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';
        const response = await fetch(tpexUrl, { timeout: 10000 });
        
        if (!response.ok) {
            console.log('TPEx API请求失败，尝试方法2');
            // 方法2: 通过代码特征判断（興櫃通常是4位数字，部分有特殊编码）
            if (/^\d{4}$/.test(stockCode) && stockCode.startsWith('6')) {
                return { 
                    found: true, 
                    stock_name: `興櫃公司 ${stockCode}`,
                    suggestions: ['尝试通过TPEx公开资料获取数据']
                };
            }
            return { found: false };
        }

        const data = await response.json();
        
        // TPEx API返回的数据格式可能不同，需要根据实际情况调整
        if (Array.isArray(data)) {
            const foundStock = data.find(item => 
                item.Code === stockCode || 
                item.Name === stockCode ||
                item.Symbol === stockCode
            );

            if (foundStock) {
                return {
                    found: true,
                    stock_name: foundStock.Name || foundStock.CompanyName,
                    stock_id: foundStock.Code || foundStock.Symbol
                };
            }
        }

        return { found: false };
    } catch (error) {
        console.log('检查興櫃公司失败:', error.message);
        return { found: false };
    }
}

// 生成搜索建议
function generateSuggestions(stockCode) {
    const suggestions = [];
    
    // 根据输入格式提供建议
    if (/^\d{4}$/.test(stockCode)) {
        suggestions.push(`尝试搜索股票代码 ${stockCode}`);
        
        // 上市公司常见代码范围
        if (stockCode >= '1101' && stockCode <= '9999') {
            suggestions.push('可能是上市公司，请选择"上市公司"类型');
        }
        
        // 興櫃公司常见代码范围
        if (stockCode.startsWith('6')) {
            suggestions.push('可能是興櫃公司，请选择"興櫃公司"类型');
        }
    } else if (stockCode.length >= 2) {
        suggestions.push(`尝试搜索公司名称包含 "${stockCode}"`);
        suggestions.push('请确认股票代码是否正确');
    }
    
    suggestions.push('尝试使用完整的4位数字股票代码');
    suggestions.push('检查是否输入了正确的公司名称');
    
    return suggestions;
}