import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// --- Type Definitions ---

/** Supported actions the agent can perform */
type ImageGenAction = "generate" | "transform" | "describe";

/** Result returned by the image generation agent */
interface ImageGenResult {
  success: boolean;
  action: ImageGenAction;
  outputPath?: string;
  prompt?: string;
  description?: string;
  referenceImagesUsed?: string[];
  error?: string;
}

/** Parsed intent from the user's prompt */
interface ImageIntent {
  action: ImageGenAction;
  prompt: string;
  style?: string;
}

// --- Constants ---

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const UPLOADS_DIR = path.resolve("./uploads");
const IMAGES_DIR = path.resolve("./Images");
const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

// The model that supports native image generation
const IMAGE_MODEL = "gemini-2.5-flash-image";

// --- Helper Functions ---

/**
 * Returns the MIME type for a given file extension.
 * Gemini requires explicit MIME types for inline image data.
 */
function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return mimeMap[ext.toLowerCase()] || "image/png";
}

/**
 * Reads all image files from the uploads directory.
 * Returns an array of objects with file name, path, base64 data, and MIME type.
 */
function readUploadsDirectory(): Array<{
  name: string;
  filePath: string;
  base64: string;
  mimeType: string;
}> {
  // Ensure the uploads directory exists
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(UPLOADS_DIR);
  const imageFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  });

  return imageFiles.map((file) => {
    const filePath = path.join(UPLOADS_DIR, file);
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    const ext = path.extname(file).toLowerCase();
    return {
      name: file,
      filePath,
      base64,
      mimeType: getMimeType(ext),
    };
  });
}

/**
 * Creates a URL-friendly slug from the user's prompt.
 * Used for naming the output image file.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50); // limit length
}

/**
 * Parses the user prompt to determine what action the agent should take.
 * Uses Gemini to understand the intent, with a regex fallback.
 */
async function parseImageIntent(userPrompt: string): Promise<ImageIntent> {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const classificationPrompt = `You are an image generation intent parser. Analyze the user's prompt and return a JSON object with:
- "action": one of "generate" (create new image from text), "transform" (modify/edit an existing image), "describe" (describe what's in uploaded images)
- "prompt": the core image generation/transformation prompt extracted from the user's message
- "style": Use this only if the user have mention these words optional style modifier (e.g., "watercolor", "photorealistic", "cartoon", "oil painting", "hyper-realistic")
- "Addtional instructions": If the user is only giving textual describing of an image, then you can also genrate the image based on the description.

Rules:
- If the user mentions editing, modifying, transforming, or changing an existing image → action = "transform"
- If the user asks to describe, analyze, or tell about images → action = "describe"  
- Otherwise → action = "generate"
- Always extract the most descriptive prompt possible for image generation

User prompt: "${userPrompt}"

Respond ONLY with valid JSON, no markdown fences.`;

  try {
    const result = await model.generateContent(classificationPrompt);
    const text = result.response.text().trim();
    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action || "generate",
        prompt: parsed.prompt || userPrompt,
        style: parsed.style || undefined,
      };
    }
  } catch (err) {
    console.log("⚠️ Intent parsing failed, using defaults.");
  }

  // Fallback: simple keyword detection
  const lower = userPrompt.toLowerCase();
  if (lower.includes("describe") || lower.includes("analyze") || lower.includes("what is in")) {
    return { action: "describe", prompt: userPrompt };
  }
  if (
    lower.includes("transform") ||
    lower.includes("modify") ||
    lower.includes("edit") ||
    lower.includes("change") ||
    lower.includes("convert")
  ) {
    return { action: "transform", prompt: userPrompt };
  }
  return { action: "generate", prompt: userPrompt };
}

// --- Core Agent Functions ---

/**
 * Generates a brand-new image from a text prompt.
 * If reference images exist in ./uploads, they are sent as context.
 */
async function generateImage(
  prompt: string,
  style?: string,
  referenceImages?: Array<{ name: string; base64: string; mimeType: string }>
): Promise<ImageGenResult> {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: IMAGE_MODEL,
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    } as any, // Cast needed because the SDK types may not include responseModalities yet
  });

  // Build the content parts array
  const parts: any[] = [];

  // If there are reference images, include them as context
  if (referenceImages && referenceImages.length > 0) {
    parts.push({
      text: `I'm providing ${referenceImages.length} reference image(s) for context. Use them as inspiration or reference for the generation.`,
    });
    for (const img of referenceImages) {
      parts.push({
        inlineData: {
          data: img.base64,
          mimeType: img.mimeType,
        },
      });
    }
  }

  // Add the main generation prompt
  const fullPrompt = style
    ? `Generate an image in ${style} style: ${prompt}`
    : `Generate an image: ${prompt}`;
  parts.push({ text: fullPrompt });

  console.log("🎨 Sending image generation request to Gemini...");

  const result = await model.generateContent(parts);
  const response = result.response;

  // Extract image and text parts from the response
  let imageData: { base64: string; mimeType: string } | null = null;
  let descriptionText = "";

  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if ((part as any).inlineData) {
          const inlineData = (part as any).inlineData;
          if (inlineData.mimeType && inlineData.mimeType.startsWith("image/")) {
            imageData = {
              base64: inlineData.data,
              mimeType: inlineData.mimeType,
            };
          }
        }
        if (part.text) {
          descriptionText += part.text;
        }
      }
    }
  }

  if (!imageData) {
    return {
      success: false,
      action: "generate",
      prompt,
      description: descriptionText || "No image was generated by the model.",
      error: "The model did not return an image. Try rephrasing your prompt.",
    };
  }

  // Save the generated image
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const timestamp = Date.now();
  const slug = slugify(prompt);
  const ext = imageData.mimeType === "image/png" ? ".png" : ".jpg";
  const filename = `${timestamp}-${slug}${ext}`;
  const outputPath = path.join(IMAGES_DIR, filename);

  const imageBuffer = Buffer.from(imageData.base64, "base64");
  fs.writeFileSync(outputPath, imageBuffer);

  console.log(`✅ Image saved to: ${outputPath}`);

  return {
    success: true,
    action: "generate",
    outputPath,
    prompt,
    description: descriptionText || "Image generated successfully.",
    referenceImagesUsed: referenceImages?.map((img) => img.name) || [],
  };
}

/**
 * Transforms/edits existing images from ./uploads based on the user's prompt.
 * The uploaded images are sent as input, and Gemini generates a modified version.
 */
async function transformImage(
  prompt: string,
  style?: string,
  referenceImages?: Array<{ name: string; base64: string; mimeType: string }>
): Promise<ImageGenResult> {
  if (!referenceImages || referenceImages.length === 0) {
    return {
      success: false,
      action: "transform",
      prompt,
      error:
        "No reference images found in ./uploads folder. Please add images to transform.",
    };
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: IMAGE_MODEL,
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    } as any,
  });

  const parts: any[] = [];

  // Add reference images
  parts.push({
    text: `Here are the source image(s) to transform:`,
  });
  for (const img of referenceImages) {
    parts.push({
      inlineData: {
        data: img.base64,
        mimeType: img.mimeType,
      },
    });
  }

  // Add the transformation instruction
  const fullPrompt = style
    ? `Transform/edit the above image(s) in ${style} style: ${prompt}`
    : `Transform/edit the above image(s): ${prompt}`;
  parts.push({ text: fullPrompt });

  console.log("🔄 Sending image transformation request to Gemini...");

  const result = await model.generateContent(parts);
  const response = result.response;

  let imageData: { base64: string; mimeType: string } | null = null;
  let descriptionText = "";

  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if ((part as any).inlineData) {
          const inlineData = (part as any).inlineData;
          if (inlineData.mimeType && inlineData.mimeType.startsWith("image/")) {
            imageData = {
              base64: inlineData.data,
              mimeType: inlineData.mimeType,
            };
          }
        }
        if (part.text) {
          descriptionText += part.text;
        }
      }
    }
  }

  if (!imageData) {
    return {
      success: false,
      action: "transform",
      prompt,
      description: descriptionText || "No transformed image was generated.",
      error: "The model did not return an image. Try rephrasing your prompt.",
    };
  }

  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const timestamp = Date.now();
  const slug = slugify(prompt);
  const ext = imageData.mimeType === "image/png" ? ".png" : ".jpg";
  const filename = `${timestamp}-${slug}${ext}`;
  const outputPath = path.join(IMAGES_DIR, filename);

  const imageBuffer = Buffer.from(imageData.base64, "base64");
  fs.writeFileSync(outputPath, imageBuffer);

  console.log(`✅ Transformed image saved to: ${outputPath}`);

  return {
    success: true,
    action: "transform",
    outputPath,
    prompt,
    description: descriptionText || "Image transformed successfully.",
    referenceImagesUsed: referenceImages.map((img) => img.name),
  };
}

/**
 * Describes the images found in the ./uploads directory.
 * Uses Gemini's vision capabilities (no image output needed).
 */
async function describeImages(
  prompt: string,
  referenceImages?: Array<{ name: string; base64: string; mimeType: string }>
): Promise<ImageGenResult> {
  if (!referenceImages || referenceImages.length === 0) {
    return {
      success: false,
      action: "describe",
      prompt,
      error: "No images found in ./uploads folder to describe.",
    };
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const parts: any[] = [];

  for (const img of referenceImages) {
    parts.push({
      inlineData: {
        data: img.base64,
        mimeType: img.mimeType,
      },
    });
  }

  parts.push({
    text: `Describe the above image(s) in detail. ${prompt}`,
  });

  console.log("🔍 Analyzing images...");

  const result = await model.generateContent(parts);
  const descriptionText = result.response.text();

  return {
    success: true,
    action: "describe",
    prompt,
    description: descriptionText,
    referenceImagesUsed: referenceImages.map((img) => img.name),
  };
}

// --- Main Exported Function ---

/**
 * The main entry point for the Image Generation Agent.
 * Parses the user's intent, reads uploads, dispatches to the correct handler,
 * and returns the result.
 *
 * @param userPrompt - The natural language prompt from the user
 * @returns ImageGenResult with the outcome
 */
export async function runImageGenAgent(
  userPrompt: string
): Promise<ImageGenResult> {
  console.log("\n🖼️  Image Generation Agent Started");
  console.log(`📝 Prompt: "${userPrompt}"`);

  // Validate API key
  if (!GEMINI_API_KEY) {
    return {
      success: false,
      action: "generate",
      error: "GEMINI_API_KEY is not set in the .env file.",
    };
  }

  try {
    // Step 1: Parse the user's intent
    console.log("🧠 Parsing intent...");
    const intent = await parseImageIntent(userPrompt);
    console.log(`   Action: ${intent.action}`);
    console.log(`   Prompt: ${intent.prompt}`);
    if (intent.style) console.log(`   Style: ${intent.style}`);

    // Step 2: Read reference images from ./uploads
    console.log("📂 Reading uploads directory...");
    const referenceImages = readUploadsDirectory();
    if (referenceImages.length > 0) {
      console.log(
        `   Found ${referenceImages.length} image(s): ${referenceImages
          .map((img) => img.name)
          .join(", ")}`
      );
    } else {
      console.log("   No reference images found in ./uploads");
    }

    // Step 3: Dispatch to the correct handler based on action
    switch (intent.action) {
      case "generate":
        return await generateImage(intent.prompt, intent.style, referenceImages);

      case "transform":
        return await transformImage(intent.prompt, intent.style, referenceImages);

      case "describe":
        return await describeImages(intent.prompt, referenceImages);

      default:
        return await generateImage(intent.prompt, intent.style, referenceImages);
    }
  } catch (error: any) {
    console.error("❌ Image Generation Agent Error:", error.message);
    return {
      success: false,
      action: "generate",
      prompt: userPrompt,
      error: `Agent error: ${error.message}`,
    };
  }
}