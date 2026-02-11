import { GoogleGenerativeAI } from '@google/generative-ai';

const MODELS: string[] = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash'];
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 5000;

interface GeminiResult {
    success: boolean;
    text: string;
    model: string;
}

interface ReportResult {
    success: boolean;
    report?: string | null;
    error?: string;
    metadata?: {
        model: string;
        generatedAt: string;
        dataSource: string;
    } | null;
}

interface SummaryResult {
    success: boolean;
    summary?: string;
    error?: string;
}

interface ScrapedData {
    url?: string;
    likes?: number;
    comments?: number;
    views?: number;
    username?: string;
    caption?: string;
    photoUrl?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    isVideo?: boolean;
    rawData?: unknown;
}

function getGenAI(): GoogleGenerativeAI {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
}

/**
 * Call Gemini with automatic retry + model fallback on 429 errors
 */
async function callGeminiWithRetry(prompt: string): Promise<GeminiResult> {
    const genAI = getGenAI();

    for (const modelName of MODELS) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`   ↳ Trying ${modelName} (attempt ${attempt}/${MAX_RETRIES})...`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const text = result.response.text();
                return { success: true, text, model: modelName };
            } catch (error: unknown) {
                const errMsg = error instanceof Error ? error.message : String(error);
                const is429 = errMsg.includes('429') || errMsg.includes('Too Many Requests') || errMsg.includes('quota');
                if (is429 && attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY_MS * attempt;
                    console.log(`   ⏳ Rate limited. Waiting ${delay / 1000}s before retry...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                if (is429) {
                    console.log(`   ⚠️  ${modelName} quota exhausted, trying next model...`);
                    break; // try next model
                }
                // Non-429 error → throw immediately
                throw error;
            }
        }
    }

    throw new Error('All Gemini models exhausted their quota. Please wait or upgrade your plan.');
}

/**
 * Gemini Report Agent
 * Takes scraped social media data and generates a detailed analytical report.
 */
async function generateReport(scrapedData: ScrapedData, userQuery: string = ''): Promise<ReportResult> {
    console.log('🤖 [Gemini Agent] Generating analytical report...');

    const prompt = buildPrompt(scrapedData, userQuery);

    try {
        const { text, model: usedModel } = await callGeminiWithRetry(prompt);

        console.log('✅ [Gemini Agent] Report generated successfully!');
        return {
            success: true,
            report: text,
            metadata: {
                model: usedModel,
                generatedAt: new Date().toISOString(),
                dataSource: scrapedData.url || 'unknown'
            }
        };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ [Gemini Agent] Error:', errMsg);
        return {
            success: false,
            error: errMsg,
            report: null
        };
    }
}

function buildPrompt(data: ScrapedData, userQuery: string): string {
    // Strip rawData to keep prompt lean
    const cleanData: Record<string, unknown> = { ...data };
    delete cleanData.rawData;

    const basePrompt = `You are a social media analytics expert. Analyze the following Instagram post data and generate a comprehensive report.

## Scraped Instagram Data
\`\`\`json
${JSON.stringify(cleanData, null, 2)}
\`\`\`

## Instructions
Provide a detailed analytical report covering:

1. **Post Overview** – What type of content is it (photo/video/reel)? Who posted it? When?
2. **Engagement Metrics** – Likes, comments, views. How do these numbers compare generally?
3. **Engagement Rate Analysis** – Based on the available metrics, assess the engagement quality.
4. **Content Analysis** – Analyze the caption, hashtags, and tone.
5. **Performance Insights** – Is this a high-performing post? What signals indicate that?
6. **Recommendations** – Actionable suggestions to improve future content based on this data.
7. **Website links in the profile** - If the profile has any website links, show it to the user, if the user asks like "does the porfile has any website links?" or "Show all the website links in the profile".

## Strict Guidelines
1. Show the genuine likes, comments and views count wihout any estimation, prediction, or assumption.
2. The content analysis also contains that whether the post either video and photo will grow in the current trend


${userQuery ? `\n## Additional User Request\n${userQuery}\n` : ''}

Be specific, data-driven, and insightful. Format the report in clean markdown.`;

    return basePrompt;
}

/**
 * Quick summary generation – lighter-weight analysis
 */
async function generateQuickSummary(scrapedData: ScrapedData): Promise<SummaryResult> {
    console.log('🤖 [Gemini Agent] Generating quick summary...');

    const cleanData: Record<string, unknown> = { ...scrapedData };
    delete cleanData.rawData;

    const prompt = `Summarize this Instagram post data in 3-4 concise bullet points covering engagement, content type, and key takeaway:

${JSON.stringify(cleanData, null, 2)}`;

    try {
        const { text } = await callGeminiWithRetry(prompt);
        return { success: true, summary: text };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return { success: false, error: errMsg };
    }
}

export { generateReport, generateQuickSummary, callGeminiWithRetry };
export type { ScrapedData, ReportResult, SummaryResult, GeminiResult };
