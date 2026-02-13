import axios, { AxiosRequestConfig } from 'axios';
import dotenv from 'dotenv';
dotenv.config();

/**
 * GitHub OAuth Agent
 * Handles the full OAuth flow so users never need to know about API keys.
 * Works exactly like Lovable/V0 — user clicks "Connect GitHub" and that's it.
 */

interface TokenData {
    accessToken: string;
    tokenType: string;
    scope: string;
    connectedAt?: string;
}

interface PushResult {
    path: string;
    success: boolean;
    url?: string;
    error?: string;
}

interface FileEntry {
    path: string;
    content: string;
}

// In-memory token store (use a database in production)
const tokenStore = new Map<string, TokenData>();

/**
 * Generate the GitHub OAuth authorization URL
 * User gets redirected here to grant permission
 */
function getAuthorizationUrl(userId: string = 'default'): string {
    const params = new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID!,
        redirect_uri: process.env.GITHUB_REDIRECT_URI!,
        scope: 'repo user read:org workflow',  // permissions we need
        state: userId,  // we get this back in callback to identify the user
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange the temporary code for a permanent access token
 * Called automatically after user authorizes on GitHub
 */
async function exchangeCodeForToken(code: string): Promise<TokenData> {
    try {
        const response = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code: code,
                redirect_uri: process.env.GITHUB_REDIRECT_URI,
            },
            {
                headers: { Accept: 'application/json' },
            }
        );

        if (response.data.error) {
            throw new Error(`GitHub OAuth error: ${response.data.error_description || response.data.error}`);
        }

        return {
            accessToken: response.data.access_token,
            tokenType: response.data.token_type,
            scope: response.data.scope,
        };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ [GitHub OAuth] Token exchange failed:', errMsg);
        throw error;
    }
}

/**
 * Store token for a user
 */
function storeToken(userId: string, tokenData: TokenData): void {
    tokenStore.set(userId, {
        ...tokenData,
        connectedAt: new Date().toISOString(),
    });
    console.log(`✅ [GitHub OAuth] Token stored for user: ${userId}`);
}

/**
 * Get stored token for a user
 */
function getToken(userId: string = 'default'): TokenData | undefined {
    return tokenStore.get(userId);
}

/**
 * Check if a user has connected GitHub
 */
function isConnected(userId: string = 'default'): boolean {
    return tokenStore.has(userId);
}

/**
 * Remove connection (disconnect GitHub)
 */
function disconnect(userId: string = 'default'): void {
    tokenStore.delete(userId);
    console.log(`🔓 [GitHub OAuth] Disconnected user: ${userId}`);
}

/**
 * Make an authenticated GitHub API call on behalf of the user
 */
async function githubAPI(endpoint: string, options: { method?: string; data?: unknown; params?: Record<string, unknown> } = {}, userId: string = 'default'): Promise<any> {
    const tokenData = getToken(userId);
    if (!tokenData) {
        throw new Error('GitHub not connected. Please connect your GitHub account first.');
    }

    const { method = 'GET', data = null, params = {} } = options;

    try {
        const config: AxiosRequestConfig = {
            method,
            url: `https://api.github.com${endpoint}`,
            headers: {
                Authorization: `Bearer ${tokenData.accessToken}`,
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'AgenticWorkflow-App',
            },
            data,
            params,
        };

        const response = await axios(config);
        return response.data;
    } catch (error: any) {
        if (error.response?.status === 401) {
            // Token expired or revoked
            disconnect(userId);
            throw new Error('GitHub token expired. Please reconnect your GitHub account.');
        }
        throw error;
    }
}

// ─── High-Level Actions (what the agent can do) ────────────────────────

/**
 * Get the authenticated user's profile
 */
async function getUser(userId: string = 'default'): Promise<any> {
    return await githubAPI('/user', {}, userId);
}

/**
 * List user's repositories
 */
async function listRepos(userId: string = 'default', options: { sort?: string; per_page?: number } = {}): Promise<any[]> {
    const { sort = 'updated', per_page = 10 } = options;
    return await githubAPI('/user/repos', {
        params: { sort, per_page, affiliation: 'owner' }
    }, userId);
}

/**
 * Create a new repository
 */
async function createRepo(name: string, options: { description?: string; isPrivate?: boolean; autoInit?: boolean } = {}, userId: string = 'default'): Promise<any> {
    const { description = '', isPrivate = false, autoInit = true } = options;
    return await githubAPI('/user/repos', {
        method: 'POST',
        data: {
            name,
            description,
            private: isPrivate,
            auto_init: autoInit,
        }
    }, userId);
}

/**
 * Create a file in a repo (push code)
 */
async function createOrUpdateFile(owner: string, repo: string, path: string, content: string, message: string, userId: string = 'default'): Promise<any> {
    // Check if file exists (to get SHA for update)
    let sha: string | null = null;
    try {
        const existing = await githubAPI(`/repos/${owner}/${repo}/contents/${path}`, {}, userId);
        sha = existing.sha;
    } catch {
        // File doesn't exist — that's fine, we'll create it
    }

    const data: Record<string, unknown> = {
        message,
        content: Buffer.from(content).toString('base64'),  // GitHub API requires base64
    };
    if (sha) data.sha = sha;

    return await githubAPI(`/repos/${owner}/${repo}/contents/${path}`, {
        method: 'PUT',
        data,
    }, userId);
}

/**
 * Push an entire project to a repo (multiple files)
 */
async function pushProject(owner: string, repo: string, files: FileEntry[], commitMessage: string = 'Initial commit from Agentic Workflow', userId: string = 'default'): Promise<PushResult[]> {
    console.log(`📤 [GitHub] Pushing ${files.length} files to ${owner}/${repo}...`);

    const results: PushResult[] = [];
    for (const file of files) {
        try {
            console.log(`   📄 ${file.path}`);
            const result = await createOrUpdateFile(
                owner, repo, file.path, file.content, commitMessage, userId
            );
            results.push({ path: file.path, success: true, url: result.content?.html_url });
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`   ❌ Failed: ${file.path} - ${errMsg}`);
            results.push({ path: file.path, success: false, error: errMsg });
        }
    }

    console.log(`✅ [GitHub] Push complete: ${results.filter(r => r.success).length}/${files.length} files`);
    return results;
}

/**
 * Star a repository
 */
async function starRepo(owner: string, repo: string, userId: string = 'default'): Promise<{ starred: boolean; repo: string }> {
    await githubAPI(`/user/starred/${owner}/${repo}`, { method: 'PUT' }, userId);
    return { starred: true, repo: `${owner}/${repo}` };
}

/**
 * Create an issue
 */
async function createIssue(owner: string, repo: string, title: string, body: string = '', labels: string[] = [], userId: string = 'default'): Promise<any> {
    return await githubAPI(`/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        data: { title, body, labels }
    }, userId);
}

/**
 * List issues in a repo
 */
async function listIssues(owner: string, repo: string, userId: string = 'default'): Promise<any[]> {
    return await githubAPI(`/repos/${owner}/${repo}/issues`, {
        params: { per_page: 10, state: 'open' }
    }, userId);
}

/**
 * Create a pull request
 */
async function createPullRequest(owner: string, repo: string, title: string, head: string, base: string = 'main', body: string = '', userId: string = 'default'): Promise<any> {
    return await githubAPI(`/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        data: { title, head, base, body }
    }, userId);
}

/**
 * Get repo details
 */
async function getRepo(owner: string, repo: string, userId: string = 'default'): Promise<any> {
    return await githubAPI(`/repos/${owner}/${repo}`, {}, userId);
}

// ─── Public API (no auth needed) ───────────────────────────────────

/**
 * Get any public user's profile — NO OAuth required
 */
async function getPublicUser(username: string): Promise<any> {
    const response = await axios.get(`https://api.github.com/users/${username}`, {
        headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'AgenticWorkflow-App',
        }
    });
    return response.data;
}

/**
 * List any public user's repos — NO OAuth required
 */
async function listPublicRepos(username: string, options: { sort?: string; per_page?: number } = {}): Promise<any[]> {
    const { sort = 'updated', per_page = 30 } = options;
    const response = await axios.get(`https://api.github.com/users/${username}/repos`, {
        headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'AgenticWorkflow-App',
        },
        params: { sort, per_page, type: 'owner' }
    });
    return response.data;
}

/**
 * List all connected GitHub userIds (for multi-user CLI)
 */
function listConnectedUsers(): string[] {
    return Array.from(tokenStore.keys());
}

export {
    getAuthorizationUrl,
    exchangeCodeForToken,
    storeToken,
    getToken,
    isConnected,
    disconnect,
    githubAPI,
    getUser,
    listRepos,
    createRepo,
    createOrUpdateFile,
    pushProject,
    starRepo,
    createIssue,
    listIssues,
    createPullRequest,
    getRepo,
    getPublicUser,
    listPublicRepos,
    listConnectedUsers,
};

export type { TokenData, PushResult, FileEntry };
