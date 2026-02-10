import { getInstagramData } from './agents/instagramScraper.js';
import { generateReport, generateQuickSummary } from './agents/geminiReporter.js';
import type { ScrapedData } from './agents/geminiReporter.js';

interface WorkflowOptions {
    mode?: string;
    userQuery?: string;
}

interface WorkflowResult {
    success: boolean;
    step?: string;
    error?: string;
    url?: string;
    metrics?: {
        username: string;
        likes: number;
        comments: number;
        views: number;
        type: string;
        caption?: string;
    };
    media?: {
        photoUrl: string;
        videoUrl: string;
        thumbnailUrl: string;
    };
    report?: string | null;
    metadata?: {
        model: string;
        generatedAt: string;
        dataSource: string;
    } | null;
    completedAt?: string;
    scrapedData?: ScrapedData;
}

/**
 * Workflow Orchestrator
 * Coordinates scraping → analysis pipeline
 */
async function runAnalysisWorkflow(postUrl: string, options: WorkflowOptions = {}): Promise<WorkflowResult> {
    const { mode = 'full', userQuery = '' } = options;

    console.log('\n' + '='.repeat(60));
    console.log('🔄 AGENTIC WORKFLOW STARTED');
    console.log('='.repeat(60));
    console.log(`📌 Target: ${postUrl}`);
    console.log(`📋 Mode: ${mode}`);
    console.log('='.repeat(60) + '\n');

    // ── Step 1: Scrape ──
    console.log('── STEP 1: Scrape Instagram Data ──');
    const scrapedData = await getInstagramData(postUrl);

    if (!scrapedData.success) {
        console.error('❌ Scraping failed:', scrapedData.error);
        return {
            success: false,
            step: 'scraping',
            error: scrapedData.error
        };
    }

    console.log('✅ Scraping complete\n');

    // Print raw metrics
    console.log('── Scraped Metrics ──');
    console.log(`   👤 Username : ${scrapedData.username}`);
    console.log(`   👍 Likes    : ${(scrapedData.likes || 0).toLocaleString()}`);
    console.log(`   💬 Comments : ${(scrapedData.comments || 0).toLocaleString()}`);
    console.log(`   👁️  Views    : ${(scrapedData.views || 0).toLocaleString()}`);
    console.log(`   📁 Type     : ${scrapedData.isVideo ? 'Video/Reel' : 'Photo'}`);
    console.log('');

    // ── Step 2: Gemini Analysis ──
    console.log('── STEP 2: Gemini AI Analysis ──');

    let analysisResult;
    if (mode === 'quick') {
        analysisResult = await generateQuickSummary(scrapedData as ScrapedData);
    } else {
        analysisResult = await generateReport(scrapedData as ScrapedData, userQuery);
    }

    if (!analysisResult.success) {
        console.error('❌ Gemini analysis failed:', analysisResult.error);
        return {
            success: false,
            step: 'analysis',
            scrapedData: scrapedData as ScrapedData,
            error: analysisResult.error
        };
    }

    console.log('✅ Analysis complete\n');

    // ── Final Output ──
    const output: WorkflowResult = {
        success: true,
        url: postUrl,
        metrics: {
            username: scrapedData.username,
            likes: scrapedData.likes,
            comments: scrapedData.comments,
            views: scrapedData.views,
            type: scrapedData.isVideo ? 'Video/Reel' : 'Photo',
            caption: scrapedData.caption
        },
        media: {
            photoUrl: scrapedData.photoUrl,
            videoUrl: scrapedData.videoUrl,
            thumbnailUrl: scrapedData.thumbnailUrl
        },
        report: mode === 'quick' ? (analysisResult as any).summary : (analysisResult as any).report,
        metadata: (analysisResult as any).metadata || null,
        completedAt: new Date().toISOString()
    };

    console.log('='.repeat(60));
    console.log('📊 WORKFLOW COMPLETE');
    console.log('='.repeat(60));

    return output;
}

export { runAnalysisWorkflow };
export type { WorkflowOptions, WorkflowResult };
