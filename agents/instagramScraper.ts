import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
dotenv.config();

const APIFY_API_KEY = process.env.APIFY_API_KEY;

// Initialize the ApifyClient
const client = new ApifyClient({
    token: APIFY_API_KEY,
});

interface InstagramData {
    likes: number;
    comments: number;
    views: number;
    username: string;
    caption?: string;
    photoUrl: string;
    videoUrl: string;
    thumbnailUrl: string;
    timestamp?: string;
    url?: string;
    type?: string;
    isVideo: boolean;
    success: boolean;
    error?: string;
    note?: string;
    rawData?: unknown;
}

async function getInstagramDataApify(postUrl: string): Promise<InstagramData> {
    try {
        console.log('🚀 Starting Apify Instagram scraper...');

        const input = {
            "username": [postUrl],
            "resultsLimit": 1
        };

        console.log('⏳ Running actor (this may take 10-30 seconds)...');
        const run = await client.actor("nH2AHrwxeTRJoN5hX").call(input);

        console.log('✅ Actor completed!');

        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        if (!items || items.length === 0) {
            throw new Error('No data returned from Apify');
        }

        const data: Record<string, any> = items[0];
        console.log('✅ Data retrieved successfully!');

        const isVideo = data.type === 'Video' || data.type === 'Reel' ||
            data.__typename === 'GraphVideo' || data.videoUrl || data.videoPlayCount;

        return {
            likes: data.likesCount || data.likes || 0,
            comments: data.commentsCount || data.comments || 0,
            views: data.videoViewCount || data.playCount || data.viewCount || data.plays || data.videoPlayCount || 0,
            username: data.ownerUsername || data.username || '',
            caption: data.caption || data.text || '',

            photoUrl: !isVideo ? (data.displayUrl || data.imageUrl || data.thumbnailUrl || '') : '',
            videoUrl: isVideo ? (data.videoUrl || data.videoPlayUrl || '') : '',
            thumbnailUrl: data.thumbnailUrl || data.displayUrl || '',

            timestamp: data.timestamp || data.takenAt || '',
            url: data.url || postUrl,
            type: data.type || data.__typename || 'unknown',
            isVideo: isVideo,

            success: true,
            rawData: data
        };

    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ Apify error:', errMsg);
        if (error && typeof error === 'object' && 'response' in error) {
            console.error('Response data:', (error as any).response.data);
        }
        return {
            error: errMsg,
            likes: 0,
            comments: 0,
            views: 0,
            username: '',
            photoUrl: '',
            videoUrl: '',
            thumbnailUrl: '',
            isVideo: false,
            success: false
        };
    }
}

async function getInstagramDataCheerio(postUrl: string): Promise<InstagramData> {
    try {
        const response: AxiosResponse = await axios.get(postUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
        });

        const $ = cheerio.load(response.data);
        const description = $('meta[property="og:description"]').attr('content') || '';
        const ogImage = $('meta[property="og:image"]').attr('content') || '';
        const ogVideo = $('meta[property="og:video"]').attr('content') || '';
        const ogType = $('meta[property="og:type"]').attr('content') || '';

        const likesMatch = description.match(/([0-9,.KMB]+)\s+likes?/i);
        const commentsMatch = description.match(/([0-9,.KMB]+)\s+comments?/i);
        const usernameMatch = description.match(/- ([^\s]+) on/);

        const parseCount = (str: string): number => {
            if (!str) return 0;
            str = str.replace(/,/g, '');
            if (str.includes('K')) return Math.round(parseFloat(str) * 1000);
            if (str.includes('M')) return Math.round(parseFloat(str) * 1000000);
            return parseInt(str) || 0;
        };

        const isVideo = ogType === 'video' || ogVideo !== '';

        return {
            likes: likesMatch ? parseCount(likesMatch[1]) : 0,
            comments: commentsMatch ? parseCount(commentsMatch[1]) : 0,
            views: 0,
            username: usernameMatch ? usernameMatch[1] : '',
            photoUrl: !isVideo ? ogImage : '',
            videoUrl: isVideo ? ogVideo : '',
            thumbnailUrl: ogImage,
            isVideo: isVideo,
            success: true,
            note: 'Fallback method - views not available'
        };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
            error: errMsg,
            likes: 0,
            comments: 0,
            views: 0,
            username: '',
            photoUrl: '',
            videoUrl: '',
            thumbnailUrl: '',
            isVideo: false,
            success: false
        };
    }
}

/**
 * Instagram Scraper Agent
 * Tries Apify first, falls back to Cheerio-based scraping
 */
async function getInstagramData(postUrl: string): Promise<InstagramData> {
    console.log('📱 [Instagram Agent] Fetching data for:', postUrl);

    // Try Apify first
    const apifyResult = await getInstagramDataApify(postUrl);

    if (apifyResult.success) {
        return apifyResult;
    }

    // Fallback to cheerio
    console.log('⚠️  Apify failed, trying fallback method...');
    return await getInstagramDataCheerio(postUrl);
}

export { getInstagramData, getInstagramDataApify, getInstagramDataCheerio };
export type { InstagramData };
