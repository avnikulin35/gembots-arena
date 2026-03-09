#!/usr/bin/env python3
"""
Fine-tune Mistral-Nemo 12B (or similar) on GemBots trading dataset.
Uses QLoRA (4-bit quantization + LoRA adapters) to fit on a single 4090 (24GB).

Usage:
  pip install torch transformers datasets peft bitsandbytes accelerate trl
  python finetune-mistral.py

Output: ./gembots-trader-lora/ (LoRA adapters)
"""

import os
import json
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer

# ── Config ──────────────────────────────────────────────────────────────
MODEL_NAME = "mistralai/Mistral-Nemo-Instruct-2407"  # 12B, good for 4090
DATASET_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
TRAIN_FILE = os.path.join(DATASET_DIR, "finetune-train.jsonl")
VAL_FILE = os.path.join(DATASET_DIR, "finetune-val.jsonl")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "gembots-trader-lora")
MERGED_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "gembots-trader-merged")

# Training hyperparams
EPOCHS = 3
BATCH_SIZE = 4          # per device
GRAD_ACCUM = 4          # effective batch = 16
LEARNING_RATE = 2e-4
MAX_SEQ_LEN = 1024      # our examples are ~500-700 tokens
WARMUP_RATIO = 0.05
WEIGHT_DECAY = 0.01
LOGGING_STEPS = 50
SAVE_STEPS = 500
EVAL_STEPS = 500

# LoRA config
LORA_R = 64
LORA_ALPHA = 128
LORA_DROPOUT = 0.05
LORA_TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]


def format_chat(example):
    """Format messages into Mistral chat template."""
    return {"text": tokenizer.apply_chat_template(example["messages"], tokenize=False)}


def main():
    global tokenizer
    
    print("🚀 GemBots Trader Fine-tuning")
    print(f"   Model: {MODEL_NAME}")
    print(f"   Train: {TRAIN_FILE}")
    print(f"   Val: {VAL_FILE}")
    print(f"   Output: {OUTPUT_DIR}")
    print()

    # ── Load dataset ────────────────────────────────────────────────────
    print("📊 Loading dataset...")
    dataset = load_dataset("json", data_files={"train": TRAIN_FILE, "val": VAL_FILE})
    print(f"   Train: {len(dataset['train'])} examples")
    print(f"   Val: {len(dataset['val'])} examples")

    # ── Quantization config (4-bit QLoRA) ───────────────────────────────
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    # ── Load model + tokenizer ──────────────────────────────────────────
    print(f"🔧 Loading {MODEL_NAME}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
        attn_implementation="flash_attention_2" if torch.cuda.is_available() else None,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)

    # ── LoRA adapters ───────────────────────────────────────────────────
    lora_config = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=LORA_TARGET_MODULES,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # ── Format dataset ──────────────────────────────────────────────────
    print("📝 Formatting with chat template...")
    train_dataset = dataset["train"].map(format_chat, num_proc=4)
    val_dataset = dataset["val"].map(format_chat, num_proc=4)

    # ── Training arguments ──────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        learning_rate=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY,
        warmup_ratio=WARMUP_RATIO,
        lr_scheduler_type="cosine",
        logging_steps=LOGGING_STEPS,
        save_steps=SAVE_STEPS,
        eval_steps=EVAL_STEPS,
        eval_strategy="steps",
        save_total_limit=3,
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        optim="paged_adamw_8bit",
        max_grad_norm=0.3,
        report_to="none",
        dataloader_num_workers=4,
        remove_unused_columns=False,
    )

    # ── Trainer ─────────────────────────────────────────────────────────
    print("🏋️ Starting training...")
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        args=training_args,
        max_seq_length=MAX_SEQ_LEN,
        dataset_text_field="text",
        packing=True,  # pack short examples together for efficiency
    )

    # Train!
    trainer.train()

    # ── Save ────────────────────────────────────────────────────────────
    print(f"💾 Saving LoRA adapters to {OUTPUT_DIR}")
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)

    # ── Merge (optional) ────────────────────────────────────────────────
    print(f"🔀 Merging LoRA into base model → {MERGED_DIR}")
    try:
        from peft import AutoPeftModelForCausalLM
        merged_model = AutoPeftModelForCausalLM.from_pretrained(
            OUTPUT_DIR,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
        merged_model = merged_model.merge_and_unload()
        merged_model.save_pretrained(MERGED_DIR, safe_serialization=True)
        tokenizer.save_pretrained(MERGED_DIR)
        print("✅ Merged model saved!")
    except Exception as e:
        print(f"⚠️ Merge failed (you can do it later): {e}")

    print("\n🎉 Fine-tuning complete!")
    print(f"   LoRA adapters: {OUTPUT_DIR}")
    print(f"   Merged model: {MERGED_DIR}")
    print("\nTo use with Ollama:")
    print(f"   1. Create Modelfile pointing to {MERGED_DIR}")
    print(f"   2. ollama create gembots-trader -f Modelfile")


if __name__ == "__main__":
    main()
