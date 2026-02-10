/**
 * Interactive Agentic CLI
 * 
 * The user types a natural language prompt, Gemini parses intent,
 * scrapes Instagram data, and generates a tailored report.
 *
 * Usage:  npx tsx agent.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import readline from 'readline';
import { exec } from 'child_process';
import { parseUserIntent } from './agents/intentParser.js';
import { getInstagramData } from './agents/instagramScraper.js';
import { generateReport, generateQuickSummary } from './agents/geminiReporter.js';
import { runGitHubAgent } from './agents/githubAgent.js';
import { isConnected, getAuthorizationUrl, exchangeCodeForToken, storeToken, getUser } from './agents/githubOAuthAgent.js';
import type { ParsedIntent } from './agents/intentParser.js';
import type { GitHubAgentResult } from './agents/githubAgent.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

function openBrowser(url: string): void {
    // Windows
    exec(`start "" "${url}"`, (err) => {
        if (err) console.log(`   🔗 Open manually: ${url}`);
    });
}

async function handleInstagram(intent: ParsedIntent): Promise<void> {
    if (intent.urls.length === 0) {
        console.log('❌ No Instagram URLs found in your message. Please include a post/reel URL.');
        return;
    }

    for (const url of intent.urls) {
        console.log(`\n── Scraping: ${url} ──`);
        const data = await getInstagramData(url);

        if (!data || data.error) {
            console.log('❌ Scraping failed:', data?.error || 'Unknown error');
            continue;
        }

        console.log(`✅ Scraped: ${data.username || 'unknown'} | ❤️ ${data.likes} | 💬 ${data.comments} | 👁️ ${data.views}`);

        console.log('\n── Generating Report ──');
        let report: any;
        if (intent.action === 'quick') {
            report = await generateQuickSummary(data);
        } else {
            report = await generateReport(data, intent.userQuery);
        }

        if (report) {
            console.log('\n📊 ═══════════════════════════════════════');
            console.log(report.report || report.summary);
            console.log('═══════════════════════════════════════\n');
        } else {
            console.log('❌ Report generation failed.');
        }
    }
}

async function handleGitHub(intent: ParsedIntent, rawInput: string): Promise<void> {
    // Pass raw user input so GitHub URLs aren't lost by intent reformulation
    const query = rawInput || intent.userQuery;
    const result: GitHubAgentResult = await runGitHubAgent(query, 'cli-user');

    // If the agent says auth is needed, start the OAuth flow
    if (result.needsAuth) {
        console.log('\n⚠️  This action requires GitHub authorization.');
        console.log('   Opening browser for GitHub authorization...\n');

        const authSuccess = await startOAuthFlow(intent, rawInput);
        if (!authSuccess) {
            console.log('\n❌ GitHub authorization failed or timed out.\n');
        }
        return;
    }

    printGitHubResult(result);
}

async function startOAuthFlow(intent: ParsedIntent, rawInput: string): Promise<boolean> {
    const express = (await import('express')).default;

    const miniApp = express();
    const PORT = 9876;

    return new Promise<boolean>((resolve) => {
        let server: ReturnType<typeof miniApp.listen>;

        miniApp.get('/auth/github/callback', async (req: any, res: any) => {
            const { code } = req.query;
            if (!code) {
                res.send('❌ No code received');
                resolve(false);
                return;
            }

            try {
                const tokenData = await exchangeCodeForToken(code as string);
                storeToken('cli-user', tokenData);
                const user = await getUser('cli-user');

                res.send(`
                    <html>
                    <body style="font-family: Arial; text-align: center; padding: 50px; background: #0d1117; color: #e6edf3;">
                        <h1>✅ Connected as ${user.login}!</h1>
                        <p>You can close this window and go back to the terminal.</p>
                    </body>
                    </html>
                `);

                console.log(`\n✅ GitHub connected as: ${user.login}`);
                console.log('   Now processing your request...\n');

                server.close();

                // Re-run the original request now that we're authenticated
                const result = await runGitHubAgent(rawInput || intent.userQuery, 'cli-user');
                printGitHubResult(result);
                resolve(true);
            } catch (error: unknown) {
                const errMsg = error instanceof Error ? error.message : String(error);
                res.send(`❌ Error: ${errMsg}`);
                server.close();
                resolve(false);
            }
        });

        server = miniApp.listen(PORT, () => {
            const params = new URLSearchParams({
                client_id: process.env.GITHUB_CLIENT_ID!,
                redirect_uri: `http://localhost:${PORT}/auth/github/callback`,
                scope: 'repo user read:org workflow',
                state: 'cli-user',
            });
            const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

            console.log(`   🔗 If the browser doesn't open, visit:`);
            console.log(`   ${authUrl}\n`);
            openBrowser(authUrl);
        });

        setTimeout(() => {
            if (!isConnected('cli-user')) {
                console.log('⏰ Authorization timed out. Try again.');
                server.close();
                resolve(false);
            }
        }, 120000);
    });
}

function printGitHubResult(result: GitHubAgentResult): void {
    if (result.success) {
        console.log('\n🐙 ═══════════════════════════════════════');
        console.log(result.summary || JSON.stringify(result.rawData, null, 2));
        console.log('═══════════════════════════════════════\n');
    } else if (result.needsAuth) {
        console.log('\n⚠️ ', result.message);
    } else {
        console.log('\n❌ GitHub action failed:', result.error || 'Unknown error');
    }
}

async function main(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║         🤖 Agentic Workflow Assistant                ║');
    console.log('║                                                      ║');
    console.log('║  I can help with:                                    ║');
    console.log('║  📸 Instagram – Analyze posts, reels, stories       ║');
    console.log('║  🐙 GitHub   – Repos, issues, PRs, push code       ║');
    console.log('║                (No API key needed! Just authorize)   ║');
    console.log('║                                                      ║');
    console.log('║  Just type your request in natural language!         ║');
    console.log('║  Type "exit" to quit.                                ║');
    console.log('╚══════════════════════════════════════════════════════╝');

    const ghStatus = isConnected('cli-user') ? '✅ Connected' : '❌ Not connected (will prompt on first use)';
    console.log(`\n   GitHub: ${ghStatus}\n`);

    while (true) {
        const userInput = await prompt('🧑 You: ');

        if (!userInput || userInput.trim().toLowerCase() === 'exit') {
            console.log('👋 Goodbye!');
            rl.close();
            break;
        }

        try {
            // Step 1: Parse intent
            const intent = await parseUserIntent(userInput.trim());

            if (!intent.success) {
                console.log('❌ Could not understand your request. Please try again.');
                console.log('💡 Tip: Include an Instagram URL or mention GitHub actions.\n');
                continue;
            }

            // Step 2: Route to appropriate agent
            switch (intent.platform) {
                case 'instagram':
                    await handleInstagram(intent);
                    break;
                case 'github':
                    await handleGitHub(intent, userInput.trim());
                    break;
                default:
                    console.log('❓ I can help with Instagram analysis and GitHub actions.');
                    console.log('💡 Examples:');
                    console.log('   • "Analyze this reel https://www.instagram.com/reel/XYZ/"');
                    console.log('   • "Star the repo facebook/react"');
                    console.log('   • "Create a new repo called my-awesome-project"');
                    console.log('   • "List my GitHub repositories"\n');
            }
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error('❌ Error:', errMsg, '\n');
        }
    }
}

main();
