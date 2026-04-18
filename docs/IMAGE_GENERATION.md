# Image Generation Setup

Free local image generation for Koda using AUTOMATIC1111 Stable Diffusion WebUI.

**Hardware:** NVIDIA T1000 (8GB VRAM) · 128GB RAM · Windows  
**Cost:** Free — runs fully offline, no API key needed

---

## How it works

```
Koda agent  →  image_generate tool  →  AUTOMATIC1111 API (localhost:7860)  →  PNG saved to disk
```

AUTOMATIC1111 runs Stable Diffusion locally on your GPU. Koda calls its REST API to generate images.

---

## Step 1 — Install Python 3.10

Download from: https://www.python.org/downloads/release/python-31011/

During install, check **"Add Python to PATH"**.

Verify:
```cmd
python --version
```

---

## Step 2 — Install AUTOMATIC1111

```cmd
:: Clone the repo
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui
cd stable-diffusion-webui
```

---

## Step 3 — Download a model

You need a `.safetensors` model file. Place it in:
```
stable-diffusion-webui\models\Stable-diffusion\
```

**Recommended free models for T1000 8GB:**

| Model | Size | Best for |
|-------|------|----------|
| Realistic Vision V5.1 | 2GB | Photorealistic images |
| DreamShaper 8 | 2GB | Artistic, versatile |
| Deliberate v3 | 2GB | Detailed illustrations |
| SDXL 1.0 Base | 6.5GB | High quality (uses most VRAM) |

Download from: https://civitai.com or https://huggingface.co/models?pipeline_tag=text-to-image

Example (Realistic Vision):
```
https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE
```

Place downloaded `.safetensors` file into:
```
stable-diffusion-webui\models\Stable-diffusion\realisticVisionV51.safetensors
```

---

## Step 4 — Start AUTOMATIC1111 with API enabled

Create a file `webui-user.bat` in the `stable-diffusion-webui` folder:

```bat
@echo off
set PYTHON=
set GIT=
set VENV_DIR=
set COMMANDLINE_ARGS=--api --xformers --medvram
call webui.bat
```

> `--api` enables the REST API that Koda uses  
> `--xformers` reduces VRAM usage  
> `--medvram` optimizes for 8GB VRAM

Double-click `webui-user.bat` to launch.

First launch downloads ~4GB of dependencies automatically. Wait for:
```
Running on local URL:  http://127.0.0.1:7860
```

---

## Step 5 — Verify the API is working

```cmd
curl http://localhost:7860/sdapi/v1/sd-models
```

Should return a JSON list of your loaded models. If it does, the API is ready.

---

## Step 6 — Configure Koda

Add to your `.env` file in the Koda root:

```env
SD_BASE_URL=http://localhost:7860
```

Restart the backend:
```cmd
cd apps/backend && pnpm dev
```

---

## Step 7 — Test image generation

In the Koda chat interface, ask:

```
Generate an image of a futuristic city at night and save it to output/city.png
```

Koda will call `image_generate` → AUTOMATIC1111 → save PNG to `workspace/output/city.png`.

---

## VRAM usage by model

| Model type | VRAM used | Notes |
|-----------|-----------|-------|
| SD 1.5 (512×512) | ~2–3GB | Fast, plenty of headroom |
| SD 1.5 (768×768) | ~3–4GB | Good detail |
| SDXL (1024×1024) | ~6–7GB | High quality, tight on T1000 |
| SDXL (512×512) | ~5GB | Faster SDXL option |

Stick to SD 1.5 models at 512×512 or 768×768 for the best performance on T1000.

---

## Keep AUTOMATIC1111 running

AUTOMATIC1111 must be running in the background whenever you use image generation in Koda. You can minimise the terminal window — it stays active.

To auto-start with Windows, create a shortcut to `webui-user.bat` in:
```
shell:startup
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `could not reach AUTOMATIC1111` | Make sure `webui-user.bat` is running and shows `Running on local URL` |
| `HTTP 404` | Started without `--api` flag — add it to `COMMANDLINE_ARGS` |
| `CUDA out of memory` | Use SD 1.5 model instead of SDXL, or add `--lowvram` to args |
| Slow generation | Add `--xformers` to args — cuts generation time in half |
| Black image | Add a VAE file — download `vae-ft-mse-840000-ema-pruned.safetensors` into `models/VAE/` |
