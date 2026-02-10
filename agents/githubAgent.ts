import { GoogleGenerativeAI } from '@google/generative-ai';
import * as gh from './githubOAuthAgent.js';

const MODEL_CHAIN: string[] = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash'];

interface GitHubAgentResult {
    success: boolean;
    action?: string;
    summary?: string;
    rawData?: unknown;
    error?: string;
    needsAuth?: boolean;
    authUrl?: string;
    message?: string;
}

interface GitHubIntent {
    action: string;
    params: Record<string, any>;
}

function getGenAI(): GoogleGenerativeAI {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
}

/**
 * Call Gemini with model fallback
 */
async function callGemini(prompt: string): Promise<string> {
    const genAI = getGenAI();
    for (const model of MODEL_CHAIN) {
        try {
            const genModel = genAI.getGenerativeModel({ model });
            const result = await genModel.generateContent(prompt);
            return result.response.text();
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.log(`   ⚠️  ${model}: ${errMsg}`);
            continue;
        }
    }
    throw new Error('All Gemini models failed');
}

/**
 * Main GitHub Agent — understands natural language and executes GitHub actions
 * NO API keys needed from the user. Uses OAuth token from "Connect GitHub" flow.
 */
async function runGitHubAgent(userPrompt: string, userId: string = 'default'): Promise<GitHubAgentResult> {
    console.log('\n🐙 [GitHub Agent] Processing your request...');
    console.log(`   💬 "${userPrompt}"\n`);

    // Actions that don't need auth (public GitHub data)
    const PUBLIC_ACTIONS = ['list_user_repos', 'get_user_profile'];

    // Step 1: Parse intent with Gemini first (before auth check)
    const parsePrompt = `You are a GitHub assistant. Parse the user's request into JSON.

Actions you can perform:
- star_repo: Star a repository (needs owner, repo)
- create_issue: Create an issue (needs owner, repo, title, body)
- create_pr: Create PR (needs owner, repo, title, head, base)
- list_repos: List MY (authenticated user's) repos (no params needed)
- list_user_repos: List ANOTHER user's public repos (needs username). Use this when user provides a GitHub profile link or mentions another person's username.
- get_user_profile: Get ANOTHER user's public GitHub profile (needs username). Use this when user asks about someone else's profile.
- get_repo: Get repo info (needs owner, repo)
- list_issues: List issues (needs owner, repo)
- delete_repo: Delete a repo (needs owner, repo) — only use if user explicitly says "delete" and understands the consequences
- create_repo: Create a new repo (needs name, description, private)
- push_project: Push/create files in a repo (needs owner, repo, files as array of {path, content})
- get_profile: Get MY (authenticated user's) GitHub profile (no params needed)

IMPORTANT: If user provides a GitHub URL like https://github.com/USERNAME, extract the USERNAME. If they ask about another person's repos/profile, use list_user_repos or get_user_profile (these don't need auth).

Respond ONLY with JSON, no markdown:
{"action":"action_name","params":{"owner":"","repo":"","title":"","body":"","name":"","description":"","private":false,"head":"","base":"main","files":[],"username":""}}

User: "${userPrompt.replace(/"/g, '\\"')}"`;

    let intent: GitHubIntent;
    try {
        const text = await callGemini(parsePrompt);
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        intent = JSON.parse(cleaned);
        console.log(`   🎯 Action: ${intent.action}`);
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `Failed to understand request: ${errMsg}`,
        };
    }

    // Step 2: Check auth (only for actions that need it)
    if (!PUBLIC_ACTIONS.includes(intent.action) && !gh.isConnected(userId)) {
        const authUrl = gh.getAuthorizationUrl(userId);
        return {
            success: false,
            needsAuth: true,
            authUrl,
            message: `This action requires GitHub authorization.\n🔗 ${authUrl}`,
        };
    }

    // Step 3: Execute the action
    try {
        let result: any;
        let summary: string;

        switch (intent.action) {
            case 'get_profile': {
                result = await gh.getUser(userId);
                summary = `👤 **${result.login}** (${result.name || 'No name'})\n` +
                    `   📦 ${result.public_repos} repos | 👥 ${result.followers} followers\n` +
                    `   🔗 ${result.html_url}`;
                break;
            }

            case 'list_repos': {
                result = await gh.listRepos(userId, { per_page: 10 });
                summary = `📦 Your repositories (latest ${result.length}):\n` +
                    result.map((r: any, i: number) =>
                        `   ${i + 1}. **${r.name}** ${r.private ? '🔒' : '🌐'} — ${r.description || 'No description'}\n` +
                        `      ⭐ ${r.stargazers_count} | 🍴 ${r.forks_count} | 🔗 ${r.html_url}`
                    ).join('\n');
                break;
            }

            case 'list_user_repos': {
                const { username } = intent.params;
                if (!username) return { success: false, error: 'Username is required. Provide a GitHub username or profile URL.' };
                result = await gh.listPublicRepos(username);
                if (result.length === 0) {
                    summary = `📦 **${username}** has no public repositories.`;
                } else {
                    summary = `📦 Public repos of **${username}** (${result.length}):\n` +
                        result.map((r: any, i: number) =>
                            `   ${i + 1}. **${r.name}** 🌐 — ${r.description || 'No description'}\n` +
                            `      ⭐ ${r.stargazers_count} | 🍴 ${r.forks_count} | 🔤 ${r.language || 'N/A'} | 🔗 ${r.html_url}`
                        ).join('\n');
                }
                break;
            }

            case 'get_user_profile': {
                const { username } = intent.params;
                if (!username) return { success: false, error: 'Username is required.' };
                result = await gh.getPublicUser(username);
                summary = `👤 **${result.login}** (${result.name || 'No name'})\n` +
                    `   📝 ${result.bio || 'No bio'}\n` +
                    `   📦 ${result.public_repos} public repos | 👥 ${result.followers} followers | 👣 ${result.following} following\n` +
                    `   📍 ${result.location || 'N/A'} | 🏢 ${result.company || 'N/A'}\n` +
                    `   🔗 ${result.html_url}`;
                break;
            }

            case 'create_repo': {
                const { name, description = '', private: isPrivate = false } = intent.params;
                result = await gh.createRepo(name, { description, isPrivate }, userId);
                summary = `✅ Repository created!\n` +
                    `   📦 **${result.full_name}** ${result.private ? '🔒 Private' : '🌐 Public'}\n` +
                    `   🔗 ${result.html_url}\n` +
                    `   📡 Clone: ${result.clone_url}`;
                break;
            }

            case 'star_repo': {
                const { owner, repo } = intent.params;
                result = await gh.starRepo(owner, repo, userId);
                summary = `⭐ Done! Starred **${owner}/${repo}**`;
                break;
            }

            case 'create_issue': {
                const { owner, repo, title, body = '' } = intent.params;
                result = await gh.createIssue(owner, repo, title, body, [], userId);
                summary = `✅ Issue created!\n` +
                    `   📝 #${result.number}: **${result.title}**\n` +
                    `   🔗 ${result.html_url}`;
                break;
            }

            case 'list_issues': {
                const { owner, repo } = intent.params;
                result = await gh.listIssues(owner, repo, userId);
                if (result.length === 0) {
                    summary = `✅ No open issues in **${owner}/${repo}**`;
                } else {
                    summary = `📋 Open issues in **${owner}/${repo}** (${result.length}):\n` +
                        result.map((iss: any, i: number) =>
                            `   ${i + 1}. #${iss.number} — **${iss.title}** (by ${iss.user.login})`
                        ).join('\n');
                }
                break;
            }

            case 'get_repo': {
                const { owner, repo } = intent.params;
                result = await gh.getRepo(owner, repo, userId);
                summary = `📦 **${result.full_name}**\n` +
                    `   📝 ${result.description || 'No description'}\n` +
                    `   ⭐ ${result.stargazers_count} | 🍴 ${result.forks_count} | 👁️ ${result.watchers_count}\n` +
                    `   🔤 Language: ${result.language || 'N/A'}\n` +
                    `   🔗 ${result.html_url}`;
                break;
            }

            case 'create_pr': {
                const { owner, repo, title, head, base = 'main', body = '' } = intent.params;
                result = await gh.createPullRequest(owner, repo, title, head, base, body, userId);
                summary = `✅ Pull Request created!\n` +
                    `   🔀 #${result.number}: **${result.title}**\n` +
                    `   📌 ${result.head.ref} → ${result.base.ref}\n` +
                    `   🔗 ${result.html_url}`;
                break;
            }

            case 'push_project': {
                const { owner, repo, files } = intent.params;
                result = await gh.pushProject(owner, repo, files, 'Push from Agentic Workflow', userId);
                const succeeded = result.filter((r: any) => r.success).length;
                summary = `📤 Pushed ${succeeded}/${result.length} files to **${owner}/${repo}**\n` +
                    result.map((r: any) => `   ${r.success ? '✅' : '❌'} ${r.path}`).join('\n');
                break;
            }

            default:
                return {
                    success: false,
                    error: `Unknown action: ${intent.action}. Try: list repos, create repo, star repo, create issue, etc.`,
                };
        }

        return {
            success: true,
            action: intent.action,
            summary,
            rawData: result,
        };

    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('   ❌ Execution failed:', errMsg);

        // If 401, token expired
        if (errMsg.includes('token expired') || errMsg.includes('not connected')) {
            const authUrl = gh.getAuthorizationUrl(userId);
            return {
                success: false,
                needsAuth: true,
                authUrl,
                message: `Session expired. Please reconnect:\n🔗 ${authUrl}`,
            };
        }

        return {
            success: false,
            error: errMsg,
        };
    }
}

export {
    runGitHubAgent,
};

export type { GitHubAgentResult, GitHubIntent };
