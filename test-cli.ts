/**
 * CLI Test Script
 * Usage:
 *   npx tsx test-cli.ts <instagram-url> [--quick] [--query "your question"]
 *
 * Examples:
 *   npx tsx test-cli.ts https://www.instagram.com/p/ABC123/
 *   npx tsx test-cli.ts https://www.instagram.com/p/ABC123/ --quick
 *   npx tsx test-cli.ts https://www.instagram.com/p/ABC123/ --query "What makes this post viral?"
 */
import dotenv from 'dotenv';
dotenv.config();

import { runAnalysisWorkflow } from './workflow.js';

const args = process.argv.slice(2);

if (args.length === 0) {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║          AGENTIC WORKFLOW – Instagram Analyzer           ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Usage:                                                  ║
║    npx tsx test-cli.ts <instagram-url> [options]         ║
║                                                          ║
║  Options:                                                ║
║    --quick          Quick summary instead of full report ║
║    --query "text"   Ask a specific question about post   ║
║                                                          ║
║  Examples:                                               ║
║    npx tsx test-cli.ts https://instagram.com/p/ABC123/   ║
║    npx tsx test-cli.ts https://instagram.com/p/ABC123/ --quick ║
║    npx tsx test-cli.ts https://instagram.com/p/ABC123/ --query "engagement tips?" ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`);
    process.exit(1);
}

const postUrl = args[0];
const isQuick = args.includes('--quick');
const queryIdx = args.indexOf('--query');
const userQuery = queryIdx !== -1 && args[queryIdx + 1] ? args[queryIdx + 1] : '';

(async () => {
    try {
        const result = await runAnalysisWorkflow(postUrl, {
            mode: isQuick ? 'quick' : 'full',
            userQuery
        });

        if (!result.success) {
            console.error('\n❌ Workflow failed at step:', result.step);
            console.error('Error:', result.error);
            process.exit(1);
        }

        // Print the final report
        console.log('\n' + '═'.repeat(60));
        console.log('📊 FINAL REPORT');
        console.log('═'.repeat(60));
        console.log(`\n📌 URL: ${result.url}`);
        console.log(`👤 Username: ${result.metrics?.username}`);
        console.log(`👍 Likes: ${(result.metrics?.likes || 0).toLocaleString()}`);
        console.log(`💬 Comments: ${(result.metrics?.comments || 0).toLocaleString()}`);
        console.log(`👁️  Views: ${(result.metrics?.views || 0).toLocaleString()}`);
        console.log(`📁 Type: ${result.metrics?.type}`);
        console.log('\n' + '-'.repeat(60));
        console.log('\n' + result.report);
        console.log('\n' + '═'.repeat(60));
        console.log(`✅ Completed at: ${result.completedAt}`);
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }
})();
