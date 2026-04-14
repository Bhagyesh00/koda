"""
Merge LoRA weights into the base model and export to GGUF for deployment.

Usage:
  python scripts/merge_and_export.py
  python scripts/merge_and_export.py --lora koda-lora --output koda-finetuned.gguf

Requirements:
  Same as finetune.py + llama.cpp (clone into ./llama.cpp and build)
  git clone https://github.com/ggerganov/llama.cpp
  cd llama.cpp && pip install -r requirements.txt
"""

import os
import sys
import argparse
import subprocess
from pathlib import Path

import torch
from unsloth import FastLanguageModel

ROOT = Path(__file__).parent.parent


def parse_args():
    p = argparse.ArgumentParser(description="Merge LoRA and export to GGUF")
    p.add_argument("--lora", default=str(ROOT / "koda-lora"), help="LoRA weights directory")
    p.add_argument("--merged", default=str(ROOT / "koda-merged"), help="Merged model directory")
    p.add_argument("--output", default=str(ROOT / "koda-finetuned.gguf"), help="Output GGUF path")
    p.add_argument("--quant", default="q4_k_m", help="GGUF quantisation type")
    p.add_argument("--llama-cpp", default=str(ROOT / "llama.cpp"), help="Path to llama.cpp checkout")
    return p.parse_args()


def main():
    args = parse_args()

    if not Path(args.lora).exists():
        print(f"ERROR: LoRA directory not found: {args.lora}")
        print("  Run: python scripts/finetune.py")
        sys.exit(1)

    hf_id = os.environ.get("KODA_HF_ID")
    if not hf_id:
        print("ERROR: Set KODA_HF_ID env var (same as used for fine-tuning).")
        sys.exit(1)

    # ── Step 1: Merge LoRA into base model ────────────────────────────────────
    print(f"Loading LoRA from {args.lora}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.lora,
        max_seq_length=8192,
        dtype=torch.bfloat16,
        load_in_4bit=True,
        token=os.environ.get("HF_TOKEN"),
    )

    print(f"Merging and saving to {args.merged}...")
    model.save_pretrained_merged(
        args.merged,
        tokenizer,
        save_method="merged_16bit",
    )
    print("Merge complete.")

    # ── Step 2: Convert to GGUF ───────────────────────────────────────────────
    convert_script = Path(args.llama_cpp) / "convert_hf_to_gguf.py"
    if not convert_script.exists():
        print(f"\nERROR: llama.cpp not found at {args.llama_cpp}")
        print("Clone it with:")
        print("  git clone https://github.com/ggerganov/llama.cpp")
        print("  pip install -r llama.cpp/requirements.txt")
        sys.exit(1)

    print(f"\nConverting to GGUF ({args.quant})...")
    result = subprocess.run(
        [
            sys.executable,
            str(convert_script),
            args.merged,
            "--outfile", args.output,
            "--outtype", args.quant,
        ],
        check=False,
    )
    if result.returncode != 0:
        print("ERROR: GGUF conversion failed.")
        sys.exit(1)

    print(f"\nGGUF saved to: {args.output}")
    print()
    print("Deploy with:")
    print(f"  echo 'FROM {args.output}' > Modelfile")
    print("  echo 'PARAMETER temperature 0.2' >> Modelfile")
    print("  echo 'PARAMETER num_ctx 32768' >> Modelfile")
    print("  echo 'PARAMETER num_predict 32768' >> Modelfile")
    print("  koda model create -f Modelfile")


if __name__ == "__main__":
    main()
