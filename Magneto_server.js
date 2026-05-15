const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");
const http = require("http");
const fs = require("fs");
const { execSync } = require("child_process");
const multer = require("multer");
const FormData = require("form-data");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3002;

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "magneto.html"));
});

// ─────────────────────────────────────────────────────────────
// AI CALL — tries Groq first, falls back to DeepSeek
// ─────────────────────────────────────────────────────────────
function callAI(prompt, maxTokens, groqKey, deepseekKey, preferDeepseek) {
  const groq = groqKey || process.env.GROQ_API_KEY || "";
  const ds   = deepseekKey || process.env.DEEPSEEK_API_KEY || "";

  if (preferDeepseek && ds) return callDeepSeek(prompt, maxTokens, ds);
  if (groq)                  return callGroq(prompt, maxTokens, groq);
  if (ds)                    return callDeepSeek(prompt, maxTokens, ds);
  throw new Error("No AI key set — add a Groq or DeepSeek key in Settings.");
}

function callGroq(prompt, maxTokens, key) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens || 2500
    });
    const options = {
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", c => data += c);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices) resolve(parsed.choices[0].message.content);
          else reject(new Error("Groq: " + JSON.stringify(parsed)));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function callDeepSeek(prompt, maxTokens, key) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens || 2500
    });
    const options = {
      hostname: "api.deepseek.com",
      path: "/chat/completions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", c => data += c);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices) resolve(parsed.choices[0].message.content);
          else reject(new Error("DeepSeek: " + JSON.stringify(parsed)));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
// ─────────────────────────────────────────────────────────────
// FLUX.1-schnell via fal.ai
// ─────────────────────────────────────────────────────────────
function generateFluxImage(prompt, falKey) {
  const key = falKey || process.env.FAL_API_KEY || "";
  if (!key) throw new Error("No fal.ai key — add it in Settings to use Flux images.");

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      prompt,
      image_size: "square_hd",
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: false
    });
    const options = {
      hostname: "fal.run",
      path: "/fal-ai/flux/schnell",
      method: "POST",
      headers: {
        "Authorization": `Key ${key}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", c => data += c);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.images && parsed.images[0] && parsed.images[0].url) {
            // fal.ai returns a URL — fetch it as base64
            urlToBase64(parsed.images[0].url).then(resolve).catch(reject);
          } else if (parsed.detail || parsed.error) {
            reject(new Error("fal.ai error: " + (parsed.detail || parsed.error)));
          } else {
            reject(new Error("fal.ai: unexpected response: " + JSON.stringify(parsed).slice(0, 200)));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error("fal.ai timeout")); });
    req.write(body);
    req.end();
  });
}

// Pollinations fallback (free, no key needed)
function generatePollinationsImage(prompt) {
  const encodedPrompt = encodeURIComponent(prompt + ", high quality digital illustration");
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random()*99999)}`;
  return urlToBase64(url);
}

// ─────────────────────────────────────────────────────────────
// PRODUCT-TYPE-AWARE PROMPT ENHANCER
// ─────────────────────────────────────────────────────────────
function enhancePromptForType(prompt, productType) {
  const suffixes = {
    sticker_sheet:  "flat vector illustration, isolated on pure white background, clean crisp outlines, sticker design, cute kawaii style, no shadows, no gradients, printable sticker art",
    icon_pack:      "flat icon design, isolated on white background, clean vector lines, minimal style, consistent icon set, scalable graphic design",
    pattern:        "seamless repeating tile pattern, flat vector design, continuous repeat, surface pattern design, fabric/wallpaper ready",
    card_set:       "printable card design, elegant layout, decorative border, high quality typography, beautiful card art, greeting card aesthetic",
    wall_art:       "decorative wall art print, high detail, beautiful composition, gallery quality, printable art, home decor aesthetic, full color illustration",
    address_label:  "decorative label design, ornate border, elegant layout, small format printable art, beautiful motif",
    gift_tag:       "gift tag design, decorative border, cute illustration, hang tag style, holiday/celebration aesthetic",
    planner:        "planner page illustration, decorative header art, minimal organized layout, functional planner design element",
    worksheet:      "educational illustration, colorful and engaging, child-friendly art style, worksheet decoration element",
    template:       "professional template design, clean layout, modern aesthetic, editable graphic design element",
    ebook_cover:    "ebook cover design, professional book cover art, compelling visual, digital product cover",
    coloring_page:  "black and white line art only, coloring book page, thick clean outlines, no fills, no grey shading, no color, blank areas ready to color, adult or children coloring book style",
    party_kit:      "party decoration design, festive colorful illustration, celebration aesthetic, printable party element",
    clipart:        "clipart illustration, isolated on white background, clean graphic design, flat vector art, no background",
    logo_kit:       "logo design element, brand mark, clean vector graphic, professional logo aesthetic, scalable design",
    journal:        "journal page decoration, illustrated header or border, dot grid or lined page element, decorative journal art",
    social_media:   "social media graphic design, Instagram-ready layout, high impact visual, bold typography aesthetic",
    certificate:    "certificate design, elegant border, formal document aesthetic, award certificate layout"
  };
  const suffix = suffixes[productType] || "high quality digital illustration, printable quality";
  return prompt.replace(/(high quality digital illustration, 1024x1024)?\.?\s*$/, "") + `, ${suffix}, 1024x1024`;
}
// ─────────────────────────────────────────────────────────────
// STEP 1 — Market Spy (Competitor Analysis)
// ─────────────────────────────────────────────────────────────
app.post("/magneto/spy", async (req, res) => {
  const { niche, groq_key, deepseek_key, prefer_deepseek } = req.body;
  if (!niche) return res.status(400).json({ error: "Niche required" });

  const prompt = `You are a sharp Gumroad & Etsy market analyst. Analyze the competitive landscape for this digital product niche.

NICHE: "${niche}"

Return ONLY valid compact JSON (no markdown, no explanation):
{
  "saturation": "Low | Medium | High | Very High",
  "avg_price_range": "$X - $Y",
  "top_price_point": "$X.XX (most common price)",
  "demand_level": "Low | Medium | High | Very High",
  "trend": "Rising | Stable | Declining | Seasonal",
  "competitors": [
    {
      "name": "Example Shop or Product Name",
      "price": "$X.XX",
      "strengths": ["2-3 things they do well"],
      "weaknesses": ["2-3 gaps or complaints"],
      "estimated_sales": "low | moderate | high"
    }
  ],
  "market_gaps": ["gap 1", "gap 2", "gap 3"],
  "winning_angle": "1-2 sentence differentiation strategy to beat them",
  "keywords": ["8-10 buyer search keywords"],
  "verdict": "Go for it | Proceed with caution | Oversaturated — pivot"
}

Make competitors array have 4-5 realistic examples based on what actually sells in this niche. Be brutally honest about weaknesses.`;

  try {
    const result = await callAI(prompt, 2000, groq_key, deepseek_key, prefer_deepseek);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON returned");
    const data = JSON.parse(cleanJson(jsonMatch[0]));
    res.json(data);
  } catch (err) {
    console.error("Spy error:", err.message);
    res.status(500).json({ error: "Spy failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// STEP 2 — Generate Product Plan
// ─────────────────────────────────────────────────────────────
app.post("/magneto/generate", async (req, res) => {
  const { name, hint, category, count, groq_key, deepseek_key, prefer_deepseek, spy_context } = req.body;
  if (!name) return res.status(400).json({ error: "Product name required" });

  const numImages = parseInt(count) || 6;

  const prompt = `You are an expert Gumroad digital product seller and visual designer. You create products that actually SELL and look professional.

Product idea: "${name}"
${hint ? `Extra context: ${hint}` : ""}
Category: ${category || "Digital Product"}
${spy_context ? `\nMarket Intelligence:\n${spy_context}` : ""}

Pick the best product_type from this list based on what the user is asking for:
- "sticker_sheet" — sticker packs, clipart sets, kawaii illustrations
- "icon_pack" — icon sets, emoji packs, UI icons
- "pattern" — seamless patterns, backgrounds, textures
- "card_set" — affirmation/tarot/greeting/quote cards (one card per page)
- "wall_art" — posters, printable wall art, home decor prints
- "address_label" — decorative address labels, return labels
- "gift_tag" — printable gift tags, hang tags
- "planner" — planner pages, habit trackers, goal sheets
- "worksheet" — educational worksheets, workbook pages
- "template" — social media/business card/resume/flyer templates
- "ebook_cover" — ebook + chapter art pages
- "coloring_page" — coloring book pages (line art ONLY)
- "party_kit" — party decorations, banners, cupcake toppers
- "clipart" — clipart bundle, digital illustrations
- "logo_kit" — logo templates, brand kit elements
- "journal" — journal pages, dot grid, lined pages
- "social_media" — Instagram templates, Pinterest graphics
- "certificate" — award certificates, diploma templates

IMPORTANT: If the user asks for stickers → use sticker_sheet. Posters → wall_art. Coloring → coloring_page. Match exactly.

Color palette based on the product vibe:
- "bg_color": background hex (light or dark based on product)
- "accent_color": main accent hex
- "text_color": text hex
- "border_color": border/detail hex

Generate ${numImages} image prompts. Each prompt should describe ONE item from the product pack. Be SPECIFIC about:
- The exact subject (e.g. "a cute kawaii bunny with big eyes holding a carrot")
- The style (e.g. "flat vector illustration")
- Colors that match the palette
- NEVER say "text overlay" or "words" in image prompts — images only

Return ONLY valid compact JSON:
{
  "title": "catchy SEO Gumroad title (max 60 chars)",
  "description": "180-220 word description with bullet points and CTA. Use line breaks.",
  "summary": "1-2 sentence hook",
  "tags": "comma-separated SEO tags (8-10)",
  "price": "suggested price like 3.99 or 7.99",
  "product_type": "one type from the list",
  "style": "art style descriptor e.g. watercolor floral, flat vector, boho line art",
  "bg_color": "#hexcolor",
  "accent_color": "#hexcolor",
  "text_color": "#hexcolor",
  "border_color": "#hexcolor",
  "images": [
    {
      "name": "short label (2-3 words)",
      "prompt": "vivid detailed image prompt for Flux AI. Specific subject, style, colors, mood. End with: high quality digital illustration, 1024x1024"
    }
  ],
  "content_pages": [
    {
      "title": "page or card title",
      "body": "THE ACTUAL READY-TO-USE CONTENT the buyer prints and uses"
    }
  ]
}
CRITICAL — content_pages rules by product type:
- card_set / affirmation: generate 20-30 entries, each body = one complete affirmation statement (e.g. "I am worthy of love and belonging exactly as I am today.")
- journal / planner / diary: generate 8-12 entries, each body = actual prompts, questions, or fill-in sections the buyer writes in
- party_kit: generate 6-10 entries = actual invitation wording, banner slogans, game rules, thank you card text with [NAME] [DATE] placeholders
- worksheet / workbook: generate 6-10 entries = actual exercises, questions, fill-in activities
- ebook / guide: generate 6-10 entries = actual chapter content, tips, steps, key lessons
- coloring_page / sticker_sheet / wall_art / icon_pack / pattern: generate 1 entry with a brief description of what's included
- ALL OTHERS: generate useful, actual usable content the buyer would receive

DO NOT describe what the content will be — write the actual content itself.`;

  try {
    const result = await callAI(prompt, 4096, groq_key, deepseek_key, prefer_deepseek);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const plan = JSON.parse(cleanJson(jsonMatch[0]));
    plan.name = name;
    plan.count = numImages;
    res.json(plan);
  } catch (err) {
    console.error("Generate error:", err.message);
    res.status(500).json({ error: "Failed to generate plan: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// STEP 3 — Generate Images (Flux.1-schnell or Pollinations)
// ─────────────────────────────────────────────────────────────
app.post("/magneto/generate-images", async (req, res) => {
  const { images, fal_key, product_type, use_flux } = req.body;
  if (!images || !images.length) return res.status(400).json({ error: "No image prompts" });

  const falKey  = fal_key || process.env.FAL_API_KEY || "";
  const useFlux = use_flux !== false && !!falKey;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const results = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const enhancedPrompt = enhancePromptForType(img.prompt, product_type || "sticker_sheet");

    try {
      res.write(`data: ${JSON.stringify({ type: "progress", index: i, total: images.length, name: img.name, engine: useFlux ? "flux" : "pollinations" })}\n\n`);

      let base64;
      if (useFlux) {
        base64 = await generateFluxImage(enhancedPrompt, falKey);
      } else {
        base64 = await generatePollinationsImage(enhancedPrompt);
      }

      results.push({ name: img.name, base64 });
      res.write(`data: ${JSON.stringify({ type: "image", index: i, name: img.name, base64 })}\n\n`);
    } catch (err) {
      console.error(`Image ${i} failed:`, err.message);
      // Fallback: if Flux fails, try Pollinations
      try {
        console.log(`Falling back to Pollinations for image ${i}...`);
        const base64 = await generatePollinationsImage(enhancedPrompt);
        results.push({ name: img.name, base64 });
        res.write(`data: ${JSON.stringify({ type: "image", index: i, name: img.name, base64, fallback: true })}\n\n`);
      } catch (fallbackErr) {
        res.write(`data: ${JSON.stringify({ type: "error", index: i, name: img.name, error: err.message })}\n\n`);
        results.push({ name: img.name, base64: null, error: err.message });
      }
    }
  }

  res.write(`data: ${JSON.stringify({ type: "done", results })}\n\n`);
  res.end();
});
// ─────────────────────────────────────────────────────────────
// STEP 4 — Assemble Product PDF
// ─────────────────────────────────────────────────────────────
app.post("/magneto/create-sheet", async (req, res) => {
  const { images, title, product_type, content_pages, bg_color, accent_color, text_color, border_color } = req.body;
  const ts = Date.now();
  const dataPath   = path.join(__dirname, "uploads", `data_${ts}.json`);
  const outputPath = path.join(__dirname, "uploads", `sheet_${ts}.pdf`);
  const pyFile     = path.join(__dirname, "uploads", `script_${ts}.py`);

  const imagePaths = [];
  for (let i = 0; i < (images || []).length; i++) {
    if (!images[i] || !images[i].base64) continue;
    const imgPath = path.join(__dirname, "uploads", `img_${ts}_${i}.png`);
    const b64 = images[i].base64.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(imgPath, Buffer.from(b64, "base64"));
    imagePaths.push({ path: imgPath, name: images[i].name || `Item ${i + 1}` });
  }

  fs.writeFileSync(dataPath, JSON.stringify({
    title, imagePaths,
    product_type: product_type || "sticker_sheet",
    content_pages: content_pages || [],
    bg_color:     safeHex(bg_color,     "#ffffff"),
    accent_color: safeHex(accent_color, "#ff6bae"),
    text_color:   safeHex(text_color,   "#2d2d2d"),
    border_color: safeHex(border_color, "#ffb3d1")
  }));

  const py = buildPythonScript(dataPath, outputPath);

  try {
    fs.writeFileSync(pyFile, py);
    const result = execSync(`python3 "${pyFile}" 2>&1 || python "${pyFile}"`, { encoding: "utf8", timeout: 30000 });
    imagePaths.forEach(p => { try { fs.unlinkSync(p.path); } catch {} });
    [dataPath, pyFile].forEach(f => { try { fs.unlinkSync(f); } catch {} });

    if (result.includes("SHEET_OK") && fs.existsSync(outputPath)) {
      const pdf = fs.readFileSync(outputPath);
      const base64 = pdf.toString("base64");
      try { fs.unlinkSync(outputPath); } catch {}
      res.json({ success: true, pdf_base64: base64 });
    } else {
      throw new Error("Sheet failed: " + result.slice(0, 500));
    }
  } catch (err) {
    [dataPath, pyFile, outputPath].forEach(f => { try { fs.unlinkSync(f); } catch {} });
    console.error("Sheet error:", err.message);
    res.status(500).json({ error: "Sheet creation failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// STEP 5 — Publish to Gumroad
// ─────────────────────────────────────────────────────────────
const upload = multer({ dest: path.join(__dirname, "uploads") });
app.post("/magneto/publish", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(500).json({ error: err.message });
    const { title, description, tags, price, name, gumroad_key } = req.body;
    if (gumroad_key) process.env.GUMROAD_ACCESS_TOKEN = gumroad_key;
    const token = process.env.GUMROAD_ACCESS_TOKEN || "";
    if (!token) return res.status(500).json({ error: "Gumroad token not set. Add it in Settings." });

    try {
      const createForm = new FormData();
      createForm.append("name", title || name || "Digital Product");
      createForm.append("description", description || "");
      createForm.append("price", Math.round((parseFloat(price) || 0) * 100).toString());
      createForm.append("published", "true");

      // Clean tags: no # symbols, max 20 chars each, max 10
      if (tags) {
        const cleanedTags = tags.split(/[,;]/).map(t => t.trim().replace(/^#+/, "").slice(0, 20)).filter(Boolean).slice(0, 10);
        cleanedTags.forEach(tag => createForm.append("tags[]", tag));
      }

      const createResult = await gumroadPostForm("/products", createForm, token);
      const product = createResult.product;
      const productId = product.id;
      console.log("Product created:", productId, product.name);

      if (req.file && productId) {
        try {
          const fileForm = new FormData();
          fileForm.append("file", fs.createReadStream(req.file.path), {
            filename: (name || "product").replace(/\s+/g, "-").toLowerCase() + ".pdf",
            contentType: "application/pdf"
          });
          await gumroadPutForm("/products/" + productId, fileForm, token);
          console.log("File attached");
        } catch (fe) {
          console.error("File attach warning:", fe.message);
        }
      }

      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      res.json({ name: product.name, url: product.short_url || product.url || "", id: productId });
    } catch (err) {
      console.error("Gumroad error:", err.message);
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: "Gumroad publish failed: " + err.message });
    }
  });
});
// ─────────────────────────────────────────────────────────────
// AUTO-PLAN: spy + generate in one request (returns plan for approval)
// ─────────────────────────────────────────────────────────────
app.post("/magneto/auto-plan", async (req, res) => {
  const { name, hint, category, count, price, groq_key, deepseek_key, prefer_deepseek } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const spyResp = await fetch(`http://localhost:${PORT}/magneto/spy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: name, groq_key, deepseek_key, prefer_deepseek })
    });
    const spy_data = await spyResp.json();
    if (spy_data.error) throw new Error("Spy failed: " + spy_data.error);

    const spy_context = `Saturation: ${spy_data.saturation}. Avg price: ${spy_data.avg_price_range}. Trend: ${spy_data.trend}. Winning angle: ${spy_data.winning_angle}. Gaps: ${(spy_data.market_gaps || []).join(", ")}`;
    const genResp = await fetch(`http://localhost:${PORT}/magneto/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, hint: hint || "", category: category || "Let AI Decide", count: count || 6, price: price || "5.99", groq_key, deepseek_key, prefer_deepseek, spy_context })
    });
    const plan = await genResp.json();
    if (plan.error) throw new Error("Generate failed: " + plan.error);

    res.json({ plan, spy_data });
  } catch (err) {
    console.error("auto-plan error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// AUTO-EXECUTE: images + PDF + publish (streams SSE progress)
// ─────────────────────────────────────────────────────────────
app.post("/magneto/auto-execute", async (req, res) => {
  const { plan, fal_key, gumroad_key } = req.body;
  if (!plan) return res.status(400).json({ error: "plan required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const images = plan.images || [];
    const falKey = fal_key || process.env.FAL_API_KEY || "";
    const generatedImages = [];

    for (let i = 0; i < images.length; i++) {
      send({ type: "progress", step: "images", index: i + 1, total: images.length, name: images[i].name });
      const enhanced = enhancePromptForType(images[i].prompt || images[i].name, plan.product_type || "sticker_sheet");
      let base64 = null;
      try {
        base64 = falKey ? await generateFluxImage(enhanced, falKey) : await generatePollinationsImage(enhanced);
      } catch {
        try { base64 = await generatePollinationsImage(enhanced); } catch {}
      }
      if (base64) generatedImages.push({ name: images[i].name, base64 });
    }

    send({ type: "progress", step: "pdf" });
    const sheetResp = await fetch(`http://localhost:${PORT}/magneto/create-sheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: generatedImages,
        title: plan.title,
        product_type: plan.product_type,
        bg_color: plan.bg_color,
        accent_color: plan.accent_color,
        text_color: plan.text_color,
        border_color: plan.border_color,
        content_pages: plan.content_pages || []
      })
    });
    const sheetData = await sheetResp.json();
    if (sheetData.error) throw new Error("PDF build failed: " + sheetData.error);

    const token = gumroad_key || process.env.GUMROAD_ACCESS_TOKEN || "";
    if (token) {
      send({ type: "progress", step: "publish" });
      const pubResp = await fetch(`http://localhost:${PORT}/magneto/publish-base64`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdf_base64: sheetData.pdf_base64,
          title: plan.title,
          description: plan.description,
          tags: plan.tags,
          price: plan.price,
          gumroad_key: token
        })
      });
      const pubData = await pubResp.json();
      if (pubData.error) throw new Error("Publish failed: " + pubData.error);
      send({ type: "done", url: pubData.url, name: pubData.name });
    } else {
      send({ type: "done", url: null, name: plan.title, note: "PDF built — add a Gumroad key to publish." });
    }
  } catch (err) {
    console.error("auto-execute error:", err.message);
    send({ type: "error", message: err.message });
  }
  res.end();
});

// ─────────────────────────────────────────────────────────────
// n8n / AUTOMATION — Sync Image Generation (no SSE)
// ─────────────────────────────────────────────────────────────
app.post("/magneto/generate-images-sync", async (req, res) => {
  const { images, fal_key, product_type } = req.body;
  if (!images?.length) return res.status(400).json({ error: "images array required" });
  const falKey = fal_key || process.env.FAL_API_KEY || "";
  const results = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const enhanced = enhancePromptForType(img.prompt || img.name, product_type || "sticker_sheet");
    let base64 = null, engine = "pollinations", error = null;
    try {
      if (falKey) {
        base64 = await generateFluxImage(enhanced, falKey);
        engine = "flux";
      } else {
        base64 = await generatePollinationsImage(enhanced);
      }
    } catch (e1) {
      try {
        base64 = await generatePollinationsImage(enhanced);
        engine = "pollinations-fallback";
      } catch (e2) {
        error = e2.message;
      }
    }
    results.push({ name: img.name, base64, engine, error });
    console.log(`[n8n] image ${i + 1}/${images.length} — ${img.name} (${engine})`);
  }
  res.json({ images: results, total: images.length, failed: results.filter(r => !r.base64).length });
});

// ─────────────────────────────────────────────────────────────
// n8n / AUTOMATION — Publish from base64 PDF (no file upload)
// ─────────────────────────────────────────────────────────────
app.post("/magneto/publish-base64", async (req, res) => {
  const { pdf_base64, title, description, tags, price, gumroad_key } = req.body;
  if (!pdf_base64) return res.status(400).json({ error: "pdf_base64 required" });
  const token = gumroad_key || process.env.GUMROAD_ACCESS_TOKEN || "";
  if (!token) return res.status(400).json({ error: "gumroad_key required (or set GUMROAD_ACCESS_TOKEN in .env)" });

  const ts = Date.now();
  const pdfPath = path.join(__dirname, "uploads", `n8n_${ts}.pdf`);
  try {
    const pdfBuffer = Buffer.from(pdf_base64.replace(/^data:[^;]+;base64,/, ""), "base64");
    fs.writeFileSync(pdfPath, pdfBuffer);

    const createForm = new FormData();
    createForm.append("name", (title || "Digital Product").slice(0, 100));
    createForm.append("description", description || "");
    createForm.append("price", Math.round((parseFloat(price) || 0) * 100).toString());
    createForm.append("published", "true");
    if (tags) {
      tags.split(/[,;]/).map(t => t.trim().replace(/^#+/, "").slice(0, 20)).filter(Boolean).slice(0, 10)
        .forEach(tag => createForm.append("tags[]", tag));
    }
    const createResult = await gumroadPostForm("/products", createForm, token);
    const product = createResult.product;

    try {
      const fileForm = new FormData();
      fileForm.append("file", fs.createReadStream(pdfPath), {
        filename: (title || "product").toLowerCase().replace(/\s+/g, "-") + ".pdf",
        contentType: "application/pdf"
      });
      await gumroadPutForm("/products/" + product.id, fileForm, token);
    } catch (fe) {
      console.warn("File attach warning:", fe.message);
    }

    try { fs.unlinkSync(pdfPath); } catch {}
    res.json({ name: product.name, url: product.short_url || product.url || "", id: product.id });
  } catch (err) {
    try { fs.unlinkSync(pdfPath); } catch {}
    console.error("publish-base64 error:", err.message);
    res.status(500).json({ error: "Gumroad publish failed: " + err.message });
  }
});
// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function urlToBase64(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    try {
      const options = new URL(url);
      options.headers = { "User-Agent": "Mozilla/5.0 (compatible; Magneto/2.0)" };
      const req = lib.get(options, (resp) => {
        if (resp.statusCode === 301 || resp.statusCode === 302) {
          return urlToBase64(resp.headers.location).then(resolve).catch(reject);
        }
        const chunks = [];
        resp.on("data", chunk => chunks.push(chunk));
        resp.on("end", () => resolve("data:image/png;base64," + Buffer.concat(chunks).toString("base64")));
      }).on("error", reject);
      req.setTimeout(90000, () => { req.destroy(); reject(new Error("Timeout")); });
    } catch (e) { reject(e); }
  });
}

function safeHex(val, fallback) {
  if (!val) return fallback;
  const clean = val.replace(/#+/g, "#").trim();
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
}

function cleanJson(str) {
  str = str.replace(/```json|```/g, "");
  const start = str.indexOf("{");
  const end = str.lastIndexOf("}");
  if (start !== -1 && end !== -1) str = str.slice(start, end + 1);
  str = str.replace(/("(?:[^"\\]|\\.)*")/g, m =>
    m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  );
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return str.trim();
}

function gumroadPostForm(endpoint, form, token) {
  return new Promise((resolve, reject) => {
    form.append("access_token", token);
    const options = {
      hostname: "api.gumroad.com",
      path: "/v2" + endpoint,
      method: "POST",
      headers: form.getHeaders()
    };
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", c => data += c);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          console.log("Gumroad POST:", JSON.stringify(parsed).slice(0, 300));
          if (parsed.success) resolve(parsed);
          else reject(new Error(parsed.message || JSON.stringify(parsed)));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    form.pipe(req);
  });
}

function gumroadPutForm(endpoint, form, token) {
  return new Promise((resolve, reject) => {
    form.append("access_token", token);
    const options = {
      hostname: "api.gumroad.com",
      path: "/v2" + endpoint,
      method: "PUT",
      headers: form.getHeaders()
    };
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", c => data += c);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          console.log("Gumroad PUT:", JSON.stringify(parsed).slice(0, 200));
          if (parsed.success) resolve(parsed);
          else reject(new Error(parsed.message || JSON.stringify(parsed)));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    form.pipe(req);
  });
}
// ─────────────────────────────────────────────────────────────
// PYTHON PDF SCRIPT BUILDER
// ─────────────────────────────────────────────────────────────
function buildPythonScript(dataPath, outputPath) {
  const dp = dataPath.replace(/\\/g, "\\\\");
  const op = outputPath.replace(/\\/g, "\\\\");
  return `
import json, os, math
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

with open(r'${dp}') as f:
    d = json.load(f)

title = d.get('title', 'Digital Product')
image_paths = d.get('imagePaths', [])
_ptype_raw = d.get('product_type', 'sticker_sheet').lower().replace(' ', '_').replace('-', '_')
content_pages = d.get('content_pages', [])
BG  = d.get('bg_color', '#ffffff')

# Normalize product type aliases
def norm_ptype(p):
    if any(x in p for x in ('journal', 'diary')): return 'journal'
    if any(x in p for x in ('planner', 'planner_page')): return 'journal'
    if any(x in p for x in ('coloring', 'colouring')): return 'coloring_page'
    if any(x in p for x in ('sticker', 'icon', 'clipart', 'clip_art', 'gift_tag', 'party')): return 'sticker_sheet'
    if any(x in p for x in ('wall_art', 'poster', 'print')): return 'wall_art'
    if any(x in p for x in ('worksheet', 'education', 'activity')): return 'worksheet'
    if any(x in p for x in ('card', 'affirmation', 'flash')): return 'card_set'
    if any(x in p for x in ('address_label', 'label')): return 'address_label'
    if any(x in p for x in ('ebook', 'guide', 'book', 'template', 'resume', 'social', 'logo', 'certificate')): return 'ebook'
    return p

ptype = norm_ptype(_ptype_raw)
ACC = d.get('accent_color', '#ff6bae')
TXT = d.get('text_color', '#2d2d2d')
BRD = d.get('border_color', '#ffb3d1')
output = r'${op}'

def hex_color(h):
    try:
        h = h.lstrip('#').strip()
        if len(h) != 6: h = 'ffffff'
        r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
        return colors.Color(r,g,b)
    except:
        return colors.Color(1,1,1)

def is_dark(h):
    try:
        h = h.lstrip('#')
        r,g,b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
        return (0.299*r + 0.587*g + 0.114*b) < 128
    except:
        return False

def draw_img(c, path, x, y, w, h):
    try:
        c.drawImage(ImageReader(path), x, y, width=w, height=h,
                    preserveAspectRatio=True, mask='auto', anchor='c')
        return True
    except Exception as e:
        print(f'img error: {e}')
        return False

def page_bg(c, w, h):
    c.setFillColor(hex_color(BG))
    c.rect(0, 0, w, h, fill=1, stroke=0)

def accent_header(c, w, h, label, font_size=14):
    c.setFillColor(hex_color(ACC))
    c.rect(0, h-0.6*inch, w, 0.6*inch, fill=1, stroke=0)
    c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111111'))
    c.setFont('Helvetica-Bold', font_size)
    c.drawCentredString(w/2, h-0.41*inch, label[:65])

def accent_footer(c, w, label=''):
    c.setFillColor(hex_color(ACC))
    c.rect(0, 0, w, 0.35*inch, fill=1, stroke=0)
    c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111111'))
    c.setFont('Helvetica-Bold', 6)
    foot = (label or title[:70]) + '  \u2022  Personal & Commercial Use'
    c.drawCentredString(w/2, 0.12*inch, foot)

def border_rect(c, w, h, rad=12, lw=2.5):
    c.setStrokeColor(hex_color(BRD))
    c.setLineWidth(lw)
    c.roundRect(0.22*inch, 0.22*inch, w-0.44*inch, h-0.44*inch, rad, fill=0, stroke=1)


# ─── STICKER SHEET / ICON PACK / CLIPART / GIFT TAG / PARTY KIT ───
if ptype in ('sticker_sheet', 'icon_pack', 'clipart', 'gift_tag', 'party_kit'):
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    page_bg(c, w, h)
    border_rect(c, w, h)
    accent_header(c, w, h, title.upper())
    accent_footer(c, w)

    items = image_paths[:9]
    cols = 3
    rows = math.ceil(len(items) / cols)
    pad_x, pad_y = 0.55*inch, 0.55*inch
    usable_w = w - pad_x*2
    usable_h = h - 1.1*inch - 0.5*inch  # header + footer
    cell_w = usable_w / cols
    cell_h = usable_h / max(rows, 1)

    for idx, img_info in enumerate(items):
        col = idx % cols
        row = idx // cols
        cx = pad_x + col * cell_w
        # start from top (below header)
        cy = h - 0.65*inch - (row+1) * cell_h

        # cell background with subtle tint
        r2,g2,b2 = [int(BG.lstrip('#')[i:i+2],16)/255 for i in (0,2,4)]
        cell_bg = colors.Color(min(r2*0.95,1), min(g2*0.95,1), min(b2*0.95,1))
        c.setFillColor(cell_bg)
        c.setStrokeColor(hex_color(BRD))
        c.setLineWidth(0.8)
        c.roundRect(cx+6, cy+8, cell_w-12, cell_h-12, 10, fill=1, stroke=1)

        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        img_pad = 0.15*inch
        draw_img(c, ip, cx+img_pad, cy+0.3*inch, cell_w-img_pad*2, cell_h-0.55*inch)

        label = (img_info['name'] if isinstance(img_info, dict) else f'Item {idx+1}')[:22]
        c.setFillColor(hex_color(ACC))
        c.setFont('Helvetica-Bold', 7)
        c.drawCentredString(cx + cell_w/2, cy + 0.12*inch, label.upper())

    c.save()
    # ─── ADDRESS LABELS ───
elif ptype == 'address_label':
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    page_bg(c, w, h)
    accent_header(c, w, h, title.upper(), 12)
    accent_footer(c, w)
    cols, rows2 = 3, 5
    lw2 = (w - 0.8*inch) / cols
    lh2 = (h - 1.1*inch - 0.4*inch) / rows2
    for idx in range(15):
        col = idx % cols
        row = idx // cols
        lx = 0.4*inch + col * lw2
        ly = h - 0.65*inch - (row+1) * lh2
        c.setFillColor(hex_color(BG))
        c.setStrokeColor(hex_color(BRD))
        c.setLineWidth(0.6)
        c.roundRect(lx+3, ly+3, lw2-6, lh2-6, 6, fill=1, stroke=1)
        if image_paths:
            ip = image_paths[idx % len(image_paths)]
            ip = ip['path'] if isinstance(ip, dict) else ip
            draw_img(c, ip, lx+5, ly + lh2*0.2, lh2*0.6, lh2*0.6)
        c.setFillColor(hex_color(TXT))
        c.setFont('Helvetica-Bold', 7)
        c.drawString(lx + lh2*0.72, ly + lh2*0.68, 'Your Name')
        c.setFillColor(hex_color(ACC))
        c.setFont('Helvetica', 6)
        c.drawString(lx + lh2*0.72, ly + lh2*0.48, '123 Your Street')
        c.drawString(lx + lh2*0.72, ly + lh2*0.28, 'City, State  ZIP')
    c.save()

# ─── CARD SET ───
elif ptype == 'card_set':
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    total = max(len(image_paths), len(content_pages))
    for pg in range(total):
        img_info = image_paths[pg] if pg < len(image_paths) else None
        cp = content_pages[pg] if pg < len(content_pages) else None

        page_bg(c, w, h)
        # decorative double border
        c.setStrokeColor(hex_color(BRD))
        c.setLineWidth(3)
        c.roundRect(0.35*inch, 0.35*inch, w-0.7*inch, h-0.7*inch, 16, fill=0, stroke=1)
        c.setLineWidth(1)
        c.roundRect(0.5*inch, 0.5*inch, w-1*inch, h-1*inch, 12, fill=0, stroke=1)

        # accent top band
        c.setFillColor(hex_color(ACC))
        c.rect(0.35*inch, h-1.3*inch, w-0.7*inch, 0.65*inch, fill=1, stroke=0)
        c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111'))
        label = cp['title'] if cp and cp.get('title') else (img_info['name'] if isinstance(img_info, dict) and img_info else f'Card {pg+1}')
        c.setFont('Helvetica-Bold', 14)
        c.drawCentredString(w/2, h-1.08*inch, label.upper()[:48])

        # image in upper portion
        img_h_frac = 0.45 if cp and cp.get('body') else 0.55
        if img_info:
            ip = img_info['path'] if isinstance(img_info, dict) else img_info
            draw_img(c, ip, 0.9*inch, h*(1 - img_h_frac) - 0.7*inch, w-1.8*inch, h*img_h_frac)

        # affirmation / saying text in lower portion
        if cp and cp.get('body'):
            body_text = cp['body'].strip()
            text_area_top = h*(1 - img_h_frac) - 0.9*inch
            text_area_bot = 1.0*inch
            text_area_h = text_area_top - text_area_bot
            # divider
            c.setStrokeColor(hex_color(ACC))
            c.setLineWidth(1)
            c.line(0.9*inch, text_area_top + 0.05*inch, w-0.9*inch, text_area_top + 0.05*inch)
            # wrap and render text centered
            from reportlab.lib.utils import simpleSplit
            from reportlab.lib.enums import TA_CENTER
            from reportlab.platypus import Paragraph
            from reportlab.lib.styles import ParagraphStyle
            max_w = w - 1.8*inch
            font_size = 13
            lines = simpleSplit(body_text, 'Helvetica', font_size, max_w)
            if len(lines) > 8: font_size = 11; lines = simpleSplit(body_text, 'Helvetica', font_size, max_w)
            if len(lines) > 12: font_size = 9; lines = simpleSplit(body_text, 'Helvetica', font_size, max_w)
            total_text_h = len(lines) * (font_size + 4)
            start_y = text_area_top - (text_area_h - total_text_h) / 2 - font_size
            c.setFillColor(hex_color(TXT))
            c.setFont('Helvetica', font_size)
            for line in lines:
                c.drawCentredString(w/2, start_y, line)
                start_y -= (font_size + 4)

        # card number + product title footer
        c.setFillColor(hex_color(ACC))
        c.setFont('Helvetica-Bold', 8)
        c.drawCentredString(w/2, 0.55*inch, f'{pg+1} / {total}')
        c.setFillColor(hex_color(TXT))
        c.setFont('Helvetica', 7)
        c.drawCentredString(w/2, 0.38*inch, (title + '  \u2022  Print & Use')[:70])
        if pg < total-1:
            c.showPage()
    c.save()

# ─── WALL ART / POSTER ───
elif ptype == 'wall_art':
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    for pg, img_info in enumerate(image_paths):
        page_bg(c, w, h)
        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        # full bleed image with thin border
        draw_img(c, ip, 0.45*inch, 0.85*inch, w-0.9*inch, h-1.7*inch)

        # bottom accent bar
        c.setFillColor(hex_color(ACC))
        c.rect(0, 0, w, 0.65*inch, fill=1, stroke=0)
        c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111'))
        label = img_info['name'] if isinstance(img_info, dict) else title
        c.setFont('Helvetica-Bold', 8)
        c.drawCentredString(w/2, 0.25*inch, label.upper() + '  \u2022  Printable Wall Art')

        # top title
        c.setFillColor(hex_color(TXT))
        c.setFont('Helvetica-Bold', 11)
        c.drawCentredString(w/2, h-0.48*inch, title[:55])

        if pg < len(image_paths)-1:
            c.showPage()
    c.save()

# ─── COLORING PAGES ───
elif ptype == 'coloring_page':
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    for pg, img_info in enumerate(image_paths):
        c.setFillColor(colors.white)
        c.rect(0, 0, w, h, fill=1, stroke=0)
        # thin decorative border
        c.setStrokeColor(colors.HexColor('#cccccc'))
        c.setLineWidth(1.5)
        c.roundRect(0.3*inch, 0.3*inch, w-0.6*inch, h-0.6*inch, 8, fill=0, stroke=1)

        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        draw_img(c, ip, 0.55*inch, 0.65*inch, w-1.1*inch, h-1.35*inch)

        label = img_info['name'] if isinstance(img_info, dict) else f'Page {pg+1}'
        c.setFillColor(colors.HexColor('#333333'))
        c.setFont('Helvetica-Bold', 10)
        c.drawCentredString(w/2, h-0.48*inch, label)
        c.setFillColor(colors.HexColor('#aaaaaa'))
        c.setFont('Helvetica', 6)
        c.drawCentredString(w/2, 0.38*inch, title + '  \u2022  Color Me!')

        if pg < len(image_paths)-1:
            c.showPage()
    c.save()
    
# ─── PLANNER / JOURNAL ───
elif ptype in ('planner', 'journal'):
    from reportlab.platypus import Paragraph
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT

    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter

    def draw_content_page(c, pg_title, pg_body, img_info=None, pg_num=1):
        page_bg(c, w, h)
        # accent header
        c.setFillColor(hex_color(ACC))
        c.rect(0, h-0.75*inch, w, 0.75*inch, fill=1, stroke=0)
        c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111'))
        c.setFont('Helvetica-Bold', 14)
        c.drawCentredString(w/2, h-0.5*inch, pg_title[:65])

        # small decorative image if available
        img_y = h - 1.65*inch
        if img_info:
            ip = img_info['path'] if isinstance(img_info, dict) else img_info
            draw_img(c, ip, 0.4*inch, img_y, 1.2*inch, 0.82*inch)

        # body text area
        margin = 0.5*inch
        body_x = (0.4 + 1.3)*inch if img_info else margin
        body_w = w - body_x - margin
        body_top = img_y + 0.82*inch - 0.05*inch

        # Draw body text with word wrap
        c.setFillColor(hex_color(TXT))
        c.setFont('Helvetica', 9)
        lines = []
        for para in (pg_body or '').split('\\n'):
            words = para.strip().split()
            cur = ''
            for word in words:
                test = (cur + ' ' + word).strip()
                if c.stringWidth(test, 'Helvetica', 9) <= body_w:
                    cur = test
                else:
                    if cur:
                        lines.append(cur)
                    cur = word
            if cur:
                lines.append(cur)
            lines.append('')  # paragraph break

        text_y = body_top
        for line in lines:
            if text_y < 1.2*inch:
                break
            c.drawString(body_x, text_y - 0.14*inch, line)
            text_y -= 0.2*inch

        # lined area below content
        c.setStrokeColor(hex_color(BRD))
        c.setLineWidth(0.4)
        line_y = min(text_y - 0.15*inch, h - 2.1*inch)
        while line_y > 0.75*inch:
            c.line(margin, line_y, w - margin, line_y)
            line_y -= 0.3*inch

        # footer
        c.setFillColor(hex_color(TXT))
        c.setFont('Helvetica', 6)
        c.drawCentredString(w/2, 0.4*inch, title + '  \u2022  Page ' + str(pg_num))

    # Decide what to render
    pages_to_render = []
    if content_pages:
        for i, cp in enumerate(content_pages):
            img = image_paths[i % len(image_paths)] if image_paths else None
            pages_to_render.append((cp.get('title', f'Page {i+1}'), cp.get('body', ''), img, i+1))
    else:
        # fallback: just show images with lined pages
        for i, img_info in enumerate(image_paths):
            label = img_info['name'] if isinstance(img_info, dict) else f'Page {i+1}'
            pages_to_render.append((label, '', img_info, i+1))

    for idx, (pg_title, pg_body, img_info, pg_num) in enumerate(pages_to_render):
        draw_content_page(c, pg_title, pg_body, img_info, pg_num)
        if idx < len(pages_to_render) - 1:
            c.showPage()
    c.save()

# ─── WORKSHEET / EDUCATIONAL ───
elif ptype == 'worksheet':
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    for pg, img_info in enumerate(image_paths):
        page_bg(c, w, h)
        c.setFillColor(hex_color(ACC))
        c.rect(0, h-0.78*inch, w, 0.78*inch, fill=1, stroke=0)

        label = img_info['name'] if isinstance(img_info, dict) else f'Worksheet {pg+1}'
        c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111'))
        c.setFont('Helvetica-Bold', 17)
        c.drawCentredString(w/2, h-0.52*inch, label)

        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        draw_img(c, ip, w-2.3*inch, h-2.2*inch, 1.8*inch, 1.3*inch)

        c.setStrokeColor(hex_color(BRD))
        c.setLineWidth(1.2)
        c.line(0.5*inch, h-1.05*inch, 3.8*inch, h-1.05*inch)
        c.line(4.2*inch, h-1.05*inch, w-0.5*inch, h-1.05*inch)
        c.setFillColor(hex_color(TXT))
        c.setFont('Helvetica', 7)
        c.drawString(0.5*inch, h-0.97*inch, 'Name:')
        c.drawString(4.2*inch, h-0.97*inch, 'Date:')

        y = h-1.55*inch
        c.setLineWidth(0.5)
        while y > 0.85*inch:
            c.line(0.5*inch, y, w-0.5*inch, y)
            y -= 0.37*inch

        c.setFillColor(hex_color(ACC))
        c.setFont('Helvetica-Bold', 6)
        c.drawCentredString(w/2, 0.5*inch, title)
        if pg < len(image_paths)-1:
            c.showPage()
    c.save()

# ─── EBOOK / GUIDE ───
elif ptype == 'ebook_cover':
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    if image_paths:
        page_bg(c, w, h)
        # cover page
        ip = image_paths[0]['path'] if isinstance(image_paths[0], dict) else image_paths[0]
        draw_img(c, ip, 1.0*inch, h*0.26, w-2.0*inch, h*0.5)

        # accent band top
        c.setFillColor(hex_color(ACC))
        c.rect(0, h-1.1*inch, w, 1.1*inch, fill=1, stroke=0)
        c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111'))
        c.setFont('Helvetica-Bold', 24)
        c.drawCentredString(w/2, h-0.65*inch, title[:40])
        c.setFont('Helvetica', 10)
        c.drawCentredString(w/2, h-0.93*inch, 'Your Complete Digital Guide')

        # bottom band
        c.setFillColor(hex_color(ACC))
        c.rect(0, 0, w, 0.5*inch, fill=1, stroke=0)
        c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111'))
        c.setFont('Helvetica-Bold', 7)
        c.drawCentredString(w/2, 0.19*inch, 'DIGITAL DOWNLOAD  \u2022  INSTANT ACCESS')

    for i, img_info in enumerate(image_paths[1:], 1):
        c.showPage()
        page_bg(c, w, h)
        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        draw_img(c, ip, 0.55*inch, h*0.25, w-1.1*inch, h*0.5)
        c.setFillColor(hex_color(ACC))
        c.setFont('Helvetica-Bold', 9)
        c.drawCentredString(w/2, h-0.7*inch, f'CHAPTER {i}')
        lbl = img_info['name'] if isinstance(img_info, dict) else f'Chapter {i}'
        c.setFillColor(hex_color(TXT))
        c.setFont('Helvetica-Bold', 18)
        c.drawCentredString(w/2, h-1.1*inch, lbl)
    c.save()

# ─── PATTERN PACK ───
elif ptype == 'pattern':
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    for pg, img_info in enumerate(image_paths):
        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        # full bleed pattern
        draw_img(c, ip, 0, 0, w, h)
        # bottom label
        c.setFillColor(hex_color(ACC))
        c.setFillAlpha(0.88)
        c.rect(0, 0, w, 0.38*inch, fill=1, stroke=0)
        c.setFillAlpha(1)
        c.setFillColor(colors.white if is_dark(ACC) else colors.HexColor('#111'))
        c.setFont('Helvetica-Bold', 7)
        lbl = (img_info['name'] if isinstance(img_info, dict) else f'Pattern {pg+1}')
        c.drawCentredString(w/2, 0.14*inch, lbl.upper() + '  \u2022  ' + title[:50])
        if pg < len(image_paths)-1:
            c.showPage()
    c.save()

# ─── SOCIAL MEDIA / TEMPLATE / CERTIFICATE / LOGO KIT ───
elif ptype in ('template', 'social_media', 'certificate', 'logo_kit'):
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    for pg, img_info in enumerate(image_paths):
        page_bg(c, w, h)
        border_rect(c, w, h, 14, 3)
        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        draw_img(c, ip, 0.65*inch, 0.85*inch, w-1.3*inch, h-1.95*inch)
        label = img_info['name'] if isinstance(img_info, dict) else f'Template {pg+1}'
        accent_header(c, w, h, label, 13)
        accent_footer(c, w)
        if pg < len(image_paths)-1:
            c.showPage()
    c.save()

# ─── FALLBACK ───
else:
    c = canvas.Canvas(output, pagesize=letter)
    w, h = letter
    for pg, img_info in enumerate(image_paths):
        page_bg(c, w, h)
        ip = img_info['path'] if isinstance(img_info, dict) else img_info
        draw_img(c, ip, 0.55*inch, 0.8*inch, w-1.1*inch, h-1.95*inch)
        label = img_info['name'] if isinstance(img_info, dict) else f'Item {pg+1}'
        accent_header(c, w, h, label)
        accent_footer(c, w)
        if pg < len(image_paths)-1:
            c.showPage()
    c.save()

print('SHEET_OK')
`;
}
// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────
// ── Generate PWA icons on first run (needs Pillow, already installed for PDF) ──
function generatePwaIcons() {
  const sizes = [192, 512];
  const missing = sizes.filter(s => !fs.existsSync(path.join(__dirname, `icon-${s}.png`)));
  if (!missing.length) return;
  const py = `
import sys
from PIL import Image, ImageDraw

def make_icon(size, out):
    img = Image.new('RGBA', (size, size), (10, 10, 10, 255))
    draw = ImageDraw.Draw(img)
    # Rounded pink background
    r = size // 5
    draw.rounded_rectangle([0, 0, size, size], radius=r, fill=(255, 60, 172, 255))
    # Inner slightly darker circle for depth
    pad = size // 10
    draw.ellipse([pad, pad, size-pad, size-pad], fill=(220, 20, 140, 255))
    # White M using lines
    lw = max(size // 14, 3)
    s = size
    pts = [
        (s*0.27, s*0.72), (s*0.27, s*0.28),
        (s*0.50, s*0.52),
        (s*0.73, s*0.28), (s*0.73, s*0.72)
    ]
    for i in range(len(pts)-1):
        draw.line([pts[i], pts[i+1]], fill='white', width=lw)
    img.save(out)

args = sys.argv[1:]
for i in range(0, len(args), 2):
    make_icon(int(args[i]), args[i+1])
`.trim();
  try {
    const pyFile = path.join(__dirname, "uploads", "_gen_icons.py");
    fs.writeFileSync(pyFile, py);
    const args = missing.map(s => `${s} "${path.join(__dirname, `icon-${s}.png`)}"`).join(" ");
    execSync(`python3 "${pyFile}" ${args} 2>&1 || python "${pyFile}" ${args}`, { encoding: "utf8", timeout: 10000 });
    try { fs.unlinkSync(pyFile); } catch {}
    console.log("  ✅ PWA icons generated");
  } catch (e) {
    console.log("  -- PWA icons skipped (Pillow not available):", e.message.slice(0, 60));
  }
}
generatePwaIcons();

app.listen(PORT, "0.0.0.0", () => {
  const groq     = process.env.GROQ_API_KEY;
  const deepseek = process.env.DEEPSEEK_API_KEY;
  const fal      = process.env.FAL_API_KEY;
  const gumroad  = process.env.GUMROAD_ACCESS_TOKEN;

  console.log("════════════════════════════════════════");
  console.log("  magneto v2 — AI Digital Product Machine");
  console.log(`  Open: http://localhost:${PORT}`);
  console.log("════════════════════════════════════════");
  console.log(groq     ? "  ✅ Groq key loaded from .env"        : "  --  No Groq key in .env       (GROQ_API_KEY)");
  console.log(deepseek ? "  ✅ DeepSeek key loaded from .env"    : "  --  No DeepSeek key in .env   (DEEPSEEK_API_KEY)");
  console.log(fal      ? "  ✅ fal.ai key loaded from .env"      : "  --  No fal.ai key in .env     (FAL_API_KEY)");
  console.log(gumroad  ? "  ✅ Gumroad token loaded from .env"   : "  --  No Gumroad token in .env  (GUMROAD_ACCESS_TOKEN)");
  console.log("  Images: " + (fal ? "Flux.1-schnell via fal.ai" : "Pollinations free fallback"));
  if (!groq && !deepseek) {
    console.log("");
    console.log("  !! No AI key found in .env");
    console.log("  !! You can still enter keys in the app's Settings panel (gear icon)");
    console.log("  !! Keys entered there are saved in your browser and work fine.");
  }
  console.log("════════════════════════════════════════");
});
