import { load } from 'https://deno.land/std/dotenv/mod.ts';
import { encodeBase64 } from 'https://deno.land/std/encoding/base64.ts';
import { Hono } from 'https://deno.land/x/hono/mod.ts';
import { cors } from 'https://deno.land/x/hono/middleware.ts';

// Load environment variables
const env = await load();

// Constants
const PROMPT = `What’s in this image? Be brief, it's for image alt description on a social network. Don't write in the first person.`;
const MAX_TOKENS = 85;
const DETAIL = 'low';
const UPLOAD_LIMIT = Deno.env.get('UPLOAD_LIMIT') || env.UPLOAD_LIMIT || 10 * 1024 * 1024; // 10MB
const API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || env.DEEPSEEK_API_KEY; // Use DeepSeek API key
const MODEL = Deno.env.get('DEEPSEEK_MODEL') || env.DEEPSEEK_MODEL || 'deepseek-vision'; // Use DeepSeek model

// Hono app
const app = new Hono();

// CORS middleware
app.use(
  '*',
  cors({
    allowMethods: ['GET', 'POST'],
  }),
);

// Function to request vision description from DeepSeek
function requestVision(image_url, { lang } = {}) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: PROMPT,
        },
        {
          type: 'image_url',
          image_url: {
            url: image_url,
            detail: DETAIL,
          },
        },
      ],
    },
  ];
  if (lang) {
    messages.push({
      role: 'system',
      content: `Answer only in this language (code): "${lang}"`,
    });
  }

  // Make a request to DeepSeek API
  return fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: MAX_TOKENS,
    }),
  }).then((res) => res.json());
}

// Root endpoint
app.get('/', async (c) => {
  const image = c.req.query('image');
  const lang = c.req.query('lang');

  if (/https?:\/\//.test(image)) {
    let response;
    try {
      response = await requestVision(image, { lang });
    } catch (error) {
      return c.json({ error: error?.message || error }, 500);
    }

    const description = response?.choices?.[0]?.message?.content;
    if (!description) {
      return c.json({ error: 'Failed to generate description' }, 500);
    }

    return c.json({ description });
  }

  return c.json({
    name: 'img-alt-api',
  });
});

// Image upload endpoint
app.post('/', async (c) => {
  const lang = c.req.query('lang');
  const { image } = await c.req.parseBody(); // File

  if (!image) {
    return c.json({ error: 'No image provided' }, 400);
  }
  if (!/^image\/(png|jpeg|webp|gif)$/.test(image.type)) {
    return c.json({ error: 'Invalid image type' }, 400);
  }
  if (image.size > UPLOAD_LIMIT) {
    return c.json({ error: 'Image size too large' }, 400);
  }

  const arrayBufferImage = await image.arrayBuffer();
  const base64Image = encodeBase64(arrayBufferImage);

  // Request to DeepSeek
  let response;
  try {
    response = await requestVision(`data:${image.type};base64,${base64Image}`, {
      lang,
    });
  } catch (error) {
    return c.json({ error: error?.message || error }, 500);
  }

  const description = response?.choices?.[0]?.message?.content;

  if (!description) {
    return c.json({ error: 'Failed to generate description' }, 500);
  }

  return c.json({ description });
});

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Start the server
Deno.serve(app.fetch);
