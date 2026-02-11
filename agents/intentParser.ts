import { callGeminiWithRetry } from './geminiReporter.js';

interface ParsedIntent {
    success: boolean;
    platform: string;
    urls: string[];
    action: string | null;
    userQuery: string;
    error?: string;
    fallback?: boolean;
}

/**
 * Intent Parser Agent
 * Uses Gemini to understand user's natural language prompt,
 * detect the platform (Instagram / GitHub / Crypto), extract URLs, and determine intent.
 */
async function parseUserIntent(userPrompt: string): Promise<ParsedIntent> {
    console.log('🧠 [Intent Agent] Understanding your request...');

    const prompt = `You are an intent-parsing assistant for a multi-platform AI agent that supports Instagram and GitHub.

The user will give you a natural language request. Your job is to extract:

1. **platform** – One of: "instagram", "github", "crypto", "unknown".
   - If user mentions GitHub, repos, repository, issues, PRs, pull requests, starring, fork, commit, push, code → "github"
   - If user mentions Instagram, posts, reels, stories, or includes instagram.com links → "instagram"
   - If user mentions crypto, bitcoin, ethereum, coin, token, price, market cap,
     BTC, ETH, SOL, or any other cryptocurrency → "crypto"

2. **urls** – Any Instagram URLs found in the prompt (array of strings). Only look for instagram.com links.
3. **action** – For Instagram: "analyze", "quick", "compare", "custom". For GitHub: "github_action". For Crypto: "crypto_action".
4. **userQuery** – The user's full request as-is (string). Do NOT leave empty for GitHub actions.

Respond ONLY with valid JSON, no markdown, no explanation. Examples:
{"platform":"instagram","urls":["https://www.instagram.com/p/ABC123/"],"action":"analyze","userQuery":""}
{"platform":"github","urls":[],"action":"github_action","userQuery":"star the repo facebook/react"}
{"platform":"github","urls":[],"action":"github_action","userQuery":"list all my repos"}

User prompt: "${userPrompt.replace(/"/g, '\\"')}"`;

    try {
        const { text } = await callGeminiWithRetry(prompt);

        // Clean up the response — strip markdown fences if present
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);

        console.log('✅ [Intent Agent] Understood!');
        console.log(`   🏷️  Platform: ${parsed.platform}`);
        if (parsed.urls?.length) console.log(`   📌 URLs found: ${parsed.urls.length}`);
        console.log(`   🎯 Action: ${parsed.action}`);
        if (parsed.userQuery) console.log(`   💬 Query: ${parsed.userQuery}`);

        return {
            success: true,
            platform: parsed.platform || 'unknown',
            urls: parsed.urls || [],
            action: parsed.action || 'analyze',
            userQuery: parsed.userQuery || userPrompt
        };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ [Intent Agent] Error:', errMsg);

        // Fallback: try regex extraction if Gemini fails
        const instaRegex = /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/gi;
        const instaUrls = userPrompt.match(instaRegex) || [];

        // Detect GitHub intent via keywords
        const githubKeywords = /\b(github|repo|repository|repos|repositories|issue|issues|pull\s*request|PR|star|fork|commit|push|branch)\b/i;
        const isGitHub = githubKeywords.test(userPrompt);

        const cryptoKeywords = /\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|coin|token|price|market\s*cap|dogecoin|doge|xrp|cardano|ada)\b/i;
        const isCrypto = cryptoKeywords.test(userPrompt);

        if (instaUrls.length > 0) {
            console.log('⚠️  Fallback: found Instagram URL(s)');
            return {
                success: true,
                platform: 'instagram',
                urls: instaUrls,
                action: 'analyze',
                userQuery: userPrompt,
                fallback: true
            };
        }

        if (isGitHub) {
            console.log('⚠️  Fallback: detected GitHub keywords');
            return {
                success: true,
                platform: 'github',
                urls: [],
                action: 'github_action',
                userQuery: userPrompt,
                fallback: true
            };
        }

        if (isCrypto) {
            console.log('⚠️  Fallback: detected Crypto keywords');
            return {
                success: true,
                platform: 'crypto',
                urls: [],
                action: 'crypto_action',
                userQuery: userPrompt,
                fallback: true
            };
        }

        return {
            success: false,
            error: errMsg,
            platform: 'unknown',
            urls: [],
            action: null,
            userQuery: userPrompt
        };
    }
}

export { parseUserIntent };
export type { ParsedIntent };
