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
import { isConnected, getAuthorizationUrl, exchangeCodeForToken, storeToken, getUser, disconnect, listConnectedUsers } from './agents/githubOAuthAgent.js';
import type { ParsedIntent } from './agents/intentParser.js';
import type { GitHubAgentResult } from './agents/githubAgent.js';
import { runCryptoAgent } from './agents/cryptoAgent.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ─── Multi-User Session ─────────────────────────────────────────
// Each GitHub account gets its own slot keyed by GitHub username.
// `activeGitHubUser` tracks who is currently "active" in the CLI.
let activeGitHubUser: string | null = null;

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
    // Use the active GitHub user (or a temp key for initial auth)
    const userId = activeGitHubUser || '__pending__';
    // Pass raw user input so GitHub URLs aren't lost by intent reformulation
    const query = rawInput || intent.userQuery;
    const result: GitHubAgentResult = await runGitHubAgent(query, userId);

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

                // Store with a temp key first to fetch the username
                storeToken('__pending__', tokenData);
                const user = await getUser('__pending__');
                const ghUsername: string = user.login;

                // Now store under the real GitHub username
                storeToken(ghUsername, tokenData);
                // Remove the temp key (if different)
                if (ghUsername !== '__pending__') {
                    disconnect('__pending__');
                }

                // Set this account as the active CLI user
                activeGitHubUser = ghUsername;

                res.send(`
                    <html>
                    <body style="font-family: Arial; text-align: center; padding: 50px; background: #0d1117; color: #e6edf3;">
                        <h1>✅ Connected as ${ghUsername}!</h1>
                        <p>You can close this window and go back to the terminal.</p>
                    </body>
                    </html>
                `);

                console.log(`\n✅ GitHub connected as: ${ghUsername}`);
                console.log(`   Active account set to: ${ghUsername}`);
                console.log('   Now processing your request...\n');

                server.close();

                // Re-run the original request now that we're authenticated
                const result = await runGitHubAgent(rawInput || intent.userQuery, ghUsername);
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
                state: 'multi-user-cli',
            });
            const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

            console.log(`   🔗 If the browser doesn't open, visit:`);
            console.log(`   ${authUrl}\n`);
            openBrowser(authUrl);
        });

        setTimeout(() => {
            server.close();
            resolve(false);
            console.log('⏰ Authorization timed out. Try again.');
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

//This for the crypto agent, which is a bit different since we want Gemini to determine the specific crypto action and parameters based on the user's prompt
async function handleCrypto(intent: ParsedIntent, rawInput: string): Promise<void> {
    const result = await runCryptoAgent(rawInput || intent.userQuery);

    if (result.success) {
        console.log('\n💰 ═══════════════════════════════════════');
        if (result.analysis) {
            console.log(result.analysis);
        } else if (Array.isArray(result.data)) {
            result.data.forEach(q => {
                console.log(`   ${q.rank}. ${q.name} (${q.symbol}): $${q.price.toLocaleString(undefined, { maximumFractionDigits: 3 })} | 24h: ${q.percent_change_24h.toFixed(2)}%`);
            });
        }
        console.log('═══════════════════════════════════════\n');
    } else {
        console.log('\n❌ Crypto agent failed:', result.error, '\n');
    }
}

async function main(): Promise<void> {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║         🤖 Agentic Workflow Assistant                ║');
    console.log('║                                                      ║');
    console.log('║  I can help with:                                    ║');
    console.log('║  📸 Instagram – Analyze posts, reels, stories       ║');
    console.log('║  🐙 GitHub   – Repos, issues, PRs, push code        ║');
    console.log('║                (No API key needed! Just authorize)   ║');
    console.log('║  🪙 Crypto   – Analyze the crypto market, and       ║');
    console.log('║                get detailed analysis per coin        ║');
    console.log('║                                                      ║');
    console.log('║  👥 Multi-user GitHub commands:                      ║');
    console.log('║     "connect github" – Link a new GitHub account    ║');
    console.log('║     "switch account" – Switch active GitHub user    ║');
    console.log('║     "accounts"       – List connected accounts      ║');
    console.log('║     "whoami"         – Show active GitHub account   ║');
    console.log('║     "disconnect"     – Remove active account        ║');
    console.log('║                                                      ║');
    console.log('║  Just type your request in natural language!         ║');
    console.log('║  Type "exit" to quit.                                ║');
    console.log('╚══════════════════════════════════════════════════════╝');

    showGitHubStatus();

    while (true) {
        const prefix = activeGitHubUser ? `[${activeGitHubUser}]` : '[no account]';
        const userInput = await prompt(`🧑 ${prefix} You: `);

        if (!userInput || userInput.trim().toLowerCase() === 'exit') {
            console.log('👋 Goodbye!');
            rl.close();
            break;
        }

        const cmd = userInput.trim().toLowerCase();

        // ─── Account management commands ───────────
        if (cmd === 'connect github' || cmd === 'add account') {
            await startOAuthFlow({ platform: 'github', urls: [], action: '', userQuery: '', success: true }, '');
            continue;
        }

        if (cmd === 'accounts' || cmd === 'list accounts') {
            showGitHubStatus();
            continue;
        }

        if (cmd === 'whoami') {
            if (activeGitHubUser) {
                console.log(`\n   🐙 Active GitHub account: ${activeGitHubUser}\n`);
            } else {
                console.log('\n   ❌ No active GitHub account. Type "connect github" to link one.\n');
            }
            continue;
        }

        if (cmd === 'switch account' || cmd === 'switch') {
            await switchAccount();
            continue;
        }

        if (cmd === 'disconnect') {
            if (activeGitHubUser) {
                const name = activeGitHubUser;
                disconnect(activeGitHubUser);
                console.log(`\n   🔓 Disconnected: ${name}`);
                // Pick the next available account, if any
                const remaining = listConnectedUsers();
                activeGitHubUser = remaining.length > 0 ? remaining[0] : null;
                if (activeGitHubUser) {
                    console.log(`   ↪️  Switched to: ${activeGitHubUser}\n`);
                } else {
                    console.log('   No accounts left. Type "connect github" to link one.\n');
                }
            } else {
                console.log('\n   ❌ No active account to disconnect.\n');
            }
            continue;
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
                case 'crypto':
                    await handleCrypto(intent, userInput.trim());
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

function showGitHubStatus(): void {
    const accounts = listConnectedUsers();
    if (accounts.length === 0) {
        console.log('\n   GitHub: ❌ No accounts connected (type "connect github" to link one)\n');
    } else {
        console.log(`\n   GitHub: ${accounts.length} account(s) connected`);
        accounts.forEach(u => {
            const marker = u === activeGitHubUser ? ' 👈 active' : '';
            console.log(`      • ${u}${marker}`);
        });
        console.log();
    }
}

async function switchAccount(): Promise<void> {
    const accounts = listConnectedUsers();
    if (accounts.length === 0) {
        console.log('\n   No accounts connected. Type "connect github" to link one.\n');
        return;
    }
    if (accounts.length === 1) {
        activeGitHubUser = accounts[0];
        console.log(`\n   Only one account available: ${activeGitHubUser} (already active)\n`);
        return;
    }

    console.log('\n   Connected accounts:');
    accounts.forEach((u, i) => {
        const marker = u === activeGitHubUser ? ' (active)' : '';
        console.log(`      ${i + 1}. ${u}${marker}`);
    });

    const choice = await prompt('   Enter number to switch to: ');
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < accounts.length) {
        activeGitHubUser = accounts[idx];
        console.log(`\n   ✅ Switched to: ${activeGitHubUser}\n`);
    } else {
        console.log('   ❌ Invalid choice.\n');
    }
}

main();
