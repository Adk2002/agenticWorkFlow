import express, { Request, Response } from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import { runAnalysisWorkflow } from './workflow.js';
import {
    getAuthorizationUrl,
    exchangeCodeForToken,
    storeToken,
    isConnected,
    disconnect,
    getUser,
} from './agents/githubOAuthAgent.js';

import { runGitHubAgent } from './agents/githubAgent.js';
import { runCryptoAgent } from './agents/cryptoAgent.js';

dotenv.config();

// Extend express-session types
declare module 'express-session' {
    interface SessionData {
        userId: string;
    }
}

const app = express();
const PORT = process.env.PORT || 6000;

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'agentic-workflow-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }  // 24 hours
}));

app.get('/', (req: Request, res: Response) => {
    const connected = isConnected(req.session.userId || 'default');
    res.json({
        message: 'Agentic Workflow API',
        github: connected ? '✅ Connected' : '❌ Not connected',
        endpoints: {
            'POST /analyze': 'Instagram analysis – { url, query? }',
            'POST /analyze/quick': 'Quick summary – { url }',
            'GET /auth/github': 'Connect your GitHub account (OAuth)',
            'GET /auth/github/callback': 'OAuth callback (automatic)',
            'GET /auth/github/status': 'Check connection status',
            'POST /auth/github/disconnect': 'Disconnect GitHub',
            'POST /github': 'Run GitHub action – { prompt }',
            'POST /crypto': 'Run a crypto agent – { prompt }',
        }
    });
});

// ─── GitHub OAuth Routes ──────────────────────────────────────────

/**
 * Step 1: User visits this → gets redirected to GitHub's authorization page
 * This is the "Connect GitHub" button equivalent
 */
app.get('/auth/github', (req: Request, res: Response) => {
    // Generate a user ID for the session
    if (!req.session.userId) {
        req.session.userId = `user_${Date.now()}`;
    }
    const authUrl = getAuthorizationUrl(req.session.userId);
    console.log(`🔗 [OAuth] Redirecting user to GitHub...`);
    res.redirect(authUrl);
});

/**
 * Step 2: GitHub redirects back here after user authorizes
 * We exchange the code for a token — user never sees the token
 */
app.get('/auth/github/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;

    if (!code) {
        res.status(400).json({ error: 'No authorization code received' });
        return;
    }

    try {
        const userId = (state as string) || req.session.userId || 'default';
        req.session.userId = userId;

        // Exchange temp code for permanent token
        const tokenData = await exchangeCodeForToken(code as string);
        storeToken(userId, tokenData);

        // Get user info to show success
        const user = await getUser(userId);

        console.log(`✅ [OAuth] GitHub connected for: ${user.login}`);

        res.send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #0d1117; color: #e6edf3;">
                <h1>✅ GitHub Connected!</h1>
                <p>Welcome, <strong>${user.login}</strong>!</p>
                <p>You can now close this window and use the agent.</p>
                <p style="color: #8b949e; margin-top: 30px;">
                    Your agent can now create repos, push code, manage issues, and more — all on your behalf.
                </p>
            </body>
            </html>
        `);
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ [OAuth] Callback error:', errMsg);
        res.status(500).send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #0d1117; color: #e6edf3;">
                <h1>❌ Connection Failed</h1>
                <p>${errMsg}</p>
                <a href="/auth/github" style="color: #58a6ff;">Try Again</a>
            </body>
            </html>
        `);
    }
});

/**
 * Check if GitHub is connected
 */
app.get('/auth/github/status', async (req: Request, res: Response) => {
    const userId = req.session.userId || 'default';
    if (isConnected(userId)) {
        const user = await getUser(userId);
        res.json({
            connected: true,
            user: {
                login: user.login,
                name: user.name,
                avatar: user.avatar_url,
                repos: user.public_repos,
            }
        });
    } else {
        res.json({ connected: false, connectUrl: '/auth/github' });
    }
});

/**
 * Disconnect GitHub
 */
app.post('/auth/github/disconnect', (req: Request, res: Response) => {
    const userId = req.session.userId || 'default';
    disconnect(userId);
    res.json({ disconnected: true });
});

/**
 * Run a GitHub action via natural language
 */
app.post('/github', async (req: Request, res: Response) => {
    const { prompt } = req.body;
    if (!prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
    }

    const userId = req.session.userId || 'default';
    const result = await runGitHubAgent(prompt, userId);

    if (result.needsAuth) {
        res.status(401).json({
            error: 'GitHub not connected',
            connectUrl: '/auth/github',
            message: result.message,
        });
        return;
    }

    res.json(result);
});

// ─── Instagram Routes ──────────────────────────────────────────

app.post('/analyze', async (req: Request, res: Response) => {
    const { url, query } = req.body;
    if (!url) {
        res.status(400).json({ error: 'url is required' });
        return;
    }

    try {
        const result = await runAnalysisWorkflow(url, { mode: 'full', userQuery: query || '' });
        res.json(result);
    } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: errMsg });
    }
});

app.post('/analyze/quick', async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url) {
        res.status(400).json({ error: 'url is required' });
        return;
    }

    try {
        const result = await runAnalysisWorkflow(url, { mode: 'quick' });
        res.json(result);
    } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: errMsg });
    }
});

// ─── Crypto Route ──────────────────────────────────────────
app.post('/crypto', async (req: Request, res: Response) => {
    const { prompt } = req.body;
    if (!prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
    }
    const result = await runCryptoAgent(prompt);
    res.json(result);
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔗 Connect GitHub: http://localhost:${PORT}/auth/github`);
    console.log(`📊 API docs: http://localhost:${PORT}/\n`);
});
