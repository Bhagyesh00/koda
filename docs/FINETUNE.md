# Fine-Tuning Koda on gemma4:e2b

Step-by-step guide for fine-tuning Koda on your local machine.

**Hardware:** NVIDIA T1000 (8GB VRAM) · 128GB RAM · 2TB SSD  
**Model:** gemma4:e2b (2B parameters, ~5–6GB VRAM with QLoRA 4-bit)

---

## Prerequisites

- Python 3.10+
- Node.js 20+ and pnpm
- Ollama running at `http://103.186.18.11:11434`
- HuggingFace account (free) at [huggingface.co](https://huggingface.co)

---

## Step 1 — Verify the HuggingFace model ID

Find which Gemma 4 2B model is available on HuggingFace:

```bash
pip install huggingface_hub

python -c "
from huggingface_hub import model_info
for m in ['unsloth/gemma-4-2b', 'google/gemma-4-2b']:
    try:
        model_info(m)
        print(f'EXISTS: {m}')
    except:
        print(f'NOT FOUND: {m}')
"
```

Use whichever exists. `unsloth/gemma-4-2b` is preferred (faster training).

---

## Step 2 — Export training data

Export real Koda chat sessions as JSONL training examples:

```bash
pnpm tsx scripts/export-training-data.ts
```

Output: `training/koda-sessions.jsonl`

**Curate the data (important):**

Open `training/koda-sessions.jsonl` in any text editor. Each line is one training example. Delete lines where:
- The model gave a wrong answer
- The model repeated itself
- The model ignored the user's request
- The tool calls were malformed

Keep only examples where the model did exactly what you wanted.  
Even 50–100 good examples is enough to start.

---

## Step 3 — Install Python dependencies

```bash
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft accelerate bitsandbytes
pip install bitsandbytes --upgrade
```

Verify GPU is detected:

```bash
python -c "import torch; print(torch.cuda.get_device_name(0))"
```

Expected output: `NVIDIA T1000`

---

## Step 4 — Set environment variables

**Windows (cmd):**
```cmd
set KODA_HF_ID=unsloth/gemma-4-2b
set HF_TOKEN=hf_xxxxxxxxxxxx
```

**Windows (PowerShell):**
```powershell
$env:KODA_HF_ID = "unsloth/gemma-4-2b"
$env:HF_TOKEN = "hf_xxxxxxxxxxxx"
```

> Get your HuggingFace token at: https://huggingface.co/settings/tokens  
> Token is only required if the model is gated (needs access approval).

---

## Step 5 — Run fine-tuning

```bash
python scripts/finetune.py --epochs 3
```

**What the script does:**
1. Downloads `gemma-4-2b` base model from HuggingFace (~5GB, one-time)
2. Adds LoRA adapters (rank 8) — only trains a small fraction of weights
3. Trains on your curated JSONL data using QLoRA 4-bit
4. Saves LoRA adapter weights to `koda-lora/`

**Monitor VRAM usage** in a separate terminal:
```bash
nvidia-smi -l 2
```

Expected VRAM usage: ~5–6GB  
Expected training time: 1–3 hours depending on dataset size

**Optional flags:**
```bash
python scripts/finetune.py --epochs 5 --lora-rank 8 --batch-size 1 --max-seq-len 4096
```

---

## Step 6 — Setup llama.cpp (one-time)

Required to convert the fine-tuned model to GGUF format for Ollama:

```bash
git clone https://github.com/ggerganov/llama.cpp
pip install -r llama.cpp/requirements.txt
```

---

## Step 7 — Merge LoRA weights and export to GGUF

```bash
python scripts/merge_and_export.py
```

**What this does:**
1. Loads the base model + LoRA adapter from `koda-lora/`
2. Merges them into a single full-precision model at `koda-merged/`
3. Converts `koda-merged/` to `koda-finetuned.gguf` using llama.cpp

Output: `koda-finetuned.gguf` (~1.5GB with q4_k_m quantization)

---

## Step 8 — Deploy to Ollama

Create a Modelfile with the compact system prompt baked in. This gives the model behavioral anchoring at the GGUF level, before any API system prompt is sent:

```bash
cat > Modelfile << 'EOF'
FROM koda-finetuned.gguf
PARAMETER temperature 0.2
PARAMETER num_ctx 32768
PARAMETER num_predict 32768
SYSTEM """
You are Koda, an AI coding assistant. You work directly inside the user's codebase.

## Tool Call Format
When you need to use a tool, output ONLY this fenced block — nothing after the closing fence:

```tool_call
{"name": "<tool_name>", "args": {...}}
```

## Core Rules
1. One tool per message. Call exactly one tool, then stop. Wait for the result before continuing.
2. Read before you touch. Always read a file before editing it. Never guess at contents.
3. Plain text when no tool is needed. If the task requires no tool, respond directly in plain text.

## When You Are Done
After all tool calls are complete, reply with a single plain-text sentence confirming the result. No fences.
"""
EOF
```

Register the model in Ollama:

```bash
ollama create koda -f Modelfile
```

Verify it works:

```bash
ollama run koda "Hello, what can you do?"
```

---

## Step 9 — Update backend config

Open `.env` and set:

```env
OLLAMA_MODEL=koda
```

Restart the backend:

```bash
cd apps/backend && pnpm dev
```

---

## Re-training (iterative improvement)

Each time the model improves, you can collect new sessions and re-train:

```
Use Koda → collect sessions → export → curate → fine-tune → deploy → repeat
```

For each re-train, start from the **previous LoRA checkpoint** to accumulate learning:

```bash
# point --data to new examples, model accumulates from koda-lora/
python scripts/finetune.py --data training/koda-curated-v2.jsonl --epochs 2
```

---

## Perfecting Prompt Adherence

If the model still doesn't follow instructions after fine-tuning, these three levers fix it:

### Lever 1 — Stateless single-turn examples
The export script now generates one-shot examples `[system, user, assistant]` from the first turn of every session. These give the model the clearest possible signal of: _given this system prompt, produce this exact output_. Multi-turn sliding windows teach context; single-turn examples teach format adherence.

### Lever 2 — Modelfile SYSTEM directive (Step 8 above)
Baking a compact system prompt into the GGUF means the model has behavioral anchoring even before the API sends its system message. A 2B model has limited attention — a short, stable prompt it saw thousands of times during training reliably wins over a long dynamic one it sees only at inference.

### Lever 3 — Non-tool-call training examples
The export script no longer filters to tool-call-only turns. Plain-text assistant responses are now included, teaching the model when **not** to emit a `tool_call` fence. Without these, the model learns to call tools for every message, including simple questions.

### Iteration loop
```
Use Koda → observe failure → export sessions → curate → fine-tune → deploy → repeat
```
Focus curation on the failure mode:
- Model never calls tools → keep only tool-call examples in curated set
- Model always calls tools → keep only plain-text examples
- Wrong tool format → keep only clean `tool_call` fence examples

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| `CUDA out of memory` | Lower `--max-seq-len 2048` or `--batch-size 1` |
| `KODA_HF_ID not set` | Run `set KODA_HF_ID=unsloth/gemma-4-2b` in same terminal |
| `Training data not found` | Run `pnpm tsx scripts/export-training-data.ts` first |
| `llama.cpp not found` | Run Step 6 — clone llama.cpp into project root |
| `ollama create` fails | Check GGUF path is correct: `ls koda-finetuned.gguf` |
| Model worse after training | Curate data more aggressively — remove bad examples |
