// agents/cryptoAgent.ts
import axios from 'axios';
import { callGeminiWithRetry } from './geminiReporter.js';

// ── Types ──────────────────────────────────────────────────

export interface CryptoQuote {
    symbol: string;
    name: string;
    price: number;
    volume_24h: number;
    percent_change_1h: number;
    percent_change_24h: number;
    percent_change_7d: number;
    market_cap: number;
    rank: number;
}

export interface CryptoAgentResult {
    success: boolean;
    action?: string;
    data?: CryptoQuote | CryptoQuote[];
    analysis?: string;
    error?: string;
}

// ── CoinMarketCap API helpers ──────────────────────────────

const CMC_BASE = 'https://pro-api.coinmarketcap.com/v1';

function cmcHeaders() {
    return { 'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_APIKEY! };
}

/**
 * Get latest quote(s) for one or more symbols (e.g. "BTC", "ETH,SOL")
 */
async function getQuotes(symbols: string): Promise<CryptoQuote[]> {
    const { data } = await axios.get(`${CMC_BASE}/cryptocurrency/quotes/latest`, {
        headers: cmcHeaders(),
        params: { symbol: symbols.toUpperCase(), convert: 'USD' },
    });

    const results: CryptoQuote[] = [];
    for (const [, coin] of Object.entries(data.data) as any) {
        const q = coin.quote.USD;
        results.push({
            symbol: coin.symbol,
            name: coin.name,
            price: q.price,
            volume_24h: q.volume_24h,
            percent_change_1h: q.percent_change_1h,
            percent_change_24h: q.percent_change_24h,
            percent_change_7d: q.percent_change_7d,
            market_cap: q.market_cap,
            rank: coin.cmc_rank,
        });
    }
    return results;
}

/**
 * Get top N coins by market cap
 */
async function getTopCoins(limit: number = 10): Promise<CryptoQuote[]> {
    const { data } = await axios.get(`${CMC_BASE}/cryptocurrency/listings/latest`, {
        headers: cmcHeaders(),
        params: { limit, convert: 'USD' },
    });

    return data.data.map((coin: any) => {
        const q = coin.quote.USD;
        return {
            symbol: coin.symbol,
            name: coin.name,
            price: q.price,
            volume_24h: q.volume_24h,
            percent_change_1h: q.percent_change_1h,
            percent_change_24h: q.percent_change_24h,
            percent_change_7d: q.percent_change_7d,
            market_cap: q.market_cap,
            rank: coin.cmc_rank,
        };
    });
}

// ── Gemini-powered analysis (reuses YOUR existing Gemini key) ──

async function analyzeWithGemini(
    quotes: CryptoQuote[],
    userQuery: string
): Promise<string> {
    const prompt = `You are a cryptocurrency market analyst. Analyze the following real-time market data and provide insights.

## Market Data
\`\`\`json
${JSON.stringify(quotes, null, 2)}
\`\`\`

## Instructions
1. **Price Overview** – Current price, rank, market cap.
2. **Momentum** – 1h / 24h / 7d % changes. Bullish or bearish?
3. **Volume Analysis** – Is trading volume healthy relative to market cap?
4. **Key Takeaway** – One-liner verdict for each coin.


${userQuery ? `\n## Additional User Request\n${userQuery}\n` : ''}

Be specific, data-driven, no speculation. Use clean markdown.`;

    const { text } = await callGeminiWithRetry(prompt);
    return text;
}

// ── Main entry point ───────────────────────────────────────

/**
 * The Crypto Agent – understands natural language via Gemini,
 * fetches data from CoinMarketCap, and generates AI analysis.
 */
export async function runCryptoAgent(userPrompt: string): Promise<CryptoAgentResult> {
    console.log('\n💰 [Crypto Agent] Processing your request...');
    console.log(`   💬 "${userPrompt}"\n`);

    // Step 1: Use Gemini to parse what the user wants
    const parsePrompt = `You are a crypto assistant. Parse the user's request into JSON.

Actions you can perform:
- get_price: Get current price/quote for specific coin(s) (needs symbols as comma-separated, e.g. "BTC,ETH")
- top_coins: Get top coins by market cap (needs limit, default 10)
- analyze: Get price + AI analysis for specific coin(s) (needs symbols)
- market_overview: Get top 10 coins + AI analysis (no params needed)

Respond ONLY with valid JSON, no markdown:
{"action":"action_name","params":{"symbols":"BTC","limit":10,"query":"user's extra question if any"}}

Examples:
User: "What's the price of Bitcoin?" → {"action":"get_price","params":{"symbols":"BTC","query":""}}
User: "Analyze ETH and SOL"        → {"action":"analyze","params":{"symbols":"ETH,SOL","query":""}}
User: "Top 20 cryptos"             → {"action":"top_coins","params":{"limit":20,"query":""}}
User: "How's the crypto market?"   → {"action":"market_overview","params":{"limit":10,"query":""}}
User: "Is Dogecoin a good buy?"    → {"action":"analyze","params":{"symbols":"DOGE","query":"Is it a good buy?"}}

User: "${userPrompt.replace(/"/g, '\\"')}"`;

    let intent: { action: string; params: Record<string, any> };
    try {
        const text = (await callGeminiWithRetry(parsePrompt)).text;
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        intent = JSON.parse(cleaned);
        console.log(`   🎯 Action: ${intent.action}`);
    } catch (err: any) {
        return { success: false, error: `Failed to parse intent: ${err.message}` };
    }

    // Step 2: Execute the action
    try {
        let quotes: CryptoQuote[];

        switch (intent.action) {
            case 'get_price': {
                quotes = await getQuotes(intent.params.symbols);
                // Pretty-print prices
                for (const q of quotes) {
                    console.log(`   📈 ${q.name} (${q.symbol}): $${q.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} | 24h: ${q.percent_change_24h.toFixed(2)}%`);
                }
                return { success: true, action: 'get_price', data: quotes };
            }

            case 'top_coins': {
                const limit = intent.params.limit || 10;
                quotes = await getTopCoins(limit);
                const summary = quotes.map((q, i) =>
                    `${i + 1}. **${q.name}** (${q.symbol}) — $${q.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} | MCap: $${(q.market_cap / 1e9).toFixed(2)}B | 24h: ${q.percent_change_24h.toFixed(2)}%`
                ).join('\n');
                return { success: true, action: 'top_coins', data: quotes, analysis: summary };
            }

            case 'analyze': {
                quotes = await getQuotes(intent.params.symbols);
                const analysis = await analyzeWithGemini(quotes, intent.params.query || '');
                return { success: true, action: 'analyze', data: quotes, analysis };
            }

            case 'market_overview': {
                quotes = await getTopCoins(intent.params.limit || 10);
                const overview = await analyzeWithGemini(quotes, intent.params.query || 'Give a market overview');
                return { success: true, action: 'market_overview', data: quotes, analysis: overview };
            }

            default:
                return { success: false, error: `Unknown action: ${intent.action}` };
        }
    } catch (err: any) {
        return { success: false, error: `CoinMarketCap API error: ${err.message}` };
    }
}