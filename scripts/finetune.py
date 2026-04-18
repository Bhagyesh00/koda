"""
Fine-tune the Koda model using Unsloth + QLoRA.

Requirements:
  pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
  pip install --no-deps trl peft accelerate bitsandbytes

Environment variables:
  KODA_HF_ID   — HuggingFace model ID for the koda base model (required)
  HF_TOKEN     — HuggingFace token if the model is gated (optional)

Usage:
  python scripts/finetune.py
  python scripts/finetune.py --data training/koda-curated.jsonl --epochs 5
"""

import os
import sys
import argparse
from pathlib import Path

import torch
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments
from unsloth import FastLanguageModel

ROOT = Path(__file__).parent.parent


def parse_args():
    p = argparse.ArgumentParser(description="Fine-tune Koda with Unsloth")
    p.add_argument(
        "--data",
        default=str(ROOT / "training" / "koda-sessions.jsonl"),
        help="Path to JSONL training file",
    )
    p.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    p.add_argument("--output", default=str(ROOT / "koda-lora"), help="Output directory for LoRA weights")
    p.add_argument("--lora-rank", type=int, default=8, help="LoRA rank (r) — use 8 for 8GB VRAM")
    p.add_argument("--batch-size", type=int, default=1, help="Per-device training batch size — use 1 for 8GB VRAM")
    p.add_argument("--max-seq-len", type=int, default=4096, help="Maximum sequence length — use 4096 for 8GB VRAM")
    return p.parse_args()


def main():
    args = parse_args()

    hf_id = os.environ.get("KODA_HF_ID")
    if not hf_id:
        print("ERROR: Set KODA_HF_ID env var to the HuggingFace model ID of the koda base model.")
        print("  Example: export KODA_HF_ID=your-org/koda-base")
        sys.exit(1)

    if not Path(args.data).exists():
        print(f"ERROR: Training data not found at {args.data}")
        print("  Run: pnpm tsx scripts/export-training-data.ts")
        sys.exit(1)

    print(f"Base model : {hf_id}")
    print(f"Data       : {args.data}")
    print(f"Output     : {args.output}")
    print(f"Epochs     : {args.epochs}")
    print(f"LoRA rank  : {args.lora_rank}")
    print()

    # ── Load base model ───────────────────────────────────────────────────────
    print("Loading base model...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=hf_id,
        max_seq_length=args.max_seq_len,
        dtype=torch.bfloat16,
        load_in_4bit=True,  # QLoRA — fits in 12 GB VRAM
        token=os.environ.get("HF_TOKEN"),
    )

    # ── Add LoRA adapters ─────────────────────────────────────────────────────
    print("Adding LoRA adapters...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=args.lora_rank,  # alpha == rank is a common default
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",  # Unsloth's memory-efficient checkpointing
        random_state=42,
    )

    # ── Load training data ────────────────────────────────────────────────────
    print(f"Loading training data from {args.data}...")
    dataset = load_dataset("json", data_files={"train": args.data}, split="train")
    print(f"  {len(dataset)} examples loaded")

    # Apply the model's chat template to format each example
    def format_example(example):
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    dataset = dataset.map(format_example, remove_columns=dataset.column_names)

    # ── Train ─────────────────────────────────────────────────────────────────
    print("Starting training...")
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_len,
        dataset_num_proc=2,
        packing=True,  # Pack short sequences for efficiency
        args=TrainingArguments(
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=8,  # effective batch=8 even with batch_size=1
            num_train_epochs=args.epochs,
            learning_rate=2e-4,
            fp16=False,
            bf16=True,
            logging_steps=10,
            output_dir=args.output,
            save_strategy="epoch",
            warmup_ratio=0.05,
            lr_scheduler_type="cosine",
            report_to="none",
            seed=42,
            dataloader_pin_memory=False,  # saves VRAM on T1000
            optim="adamw_8bit",           # 8-bit optimizer — cuts optimizer VRAM in half
        ),
    )
    trainer.train()

    # ── Save LoRA weights ─────────────────────────────────────────────────────
    print(f"\nSaving LoRA weights to {args.output}...")
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print("Done.")
    print()
    print("Next: merge + convert to GGUF:")
    print("  python scripts/merge_and_export.py")


if __name__ == "__main__":
    main()
