#!/bin/bash
# Setup script for Vast.ai instance - GemBots Trader Fine-tuning
# Run this on the Vast.ai instance first

set -e

echo "🚀 GemBots Trader Fine-tuning Setup"
echo "======================================"

# Install dependencies
echo "📦 Installing Python packages..."
pip install -q --upgrade pip
pip install -q unsloth "unsloth[colab-new]" 2>/dev/null || true
pip install -q torch transformers datasets peft bitsandbytes accelerate trl
pip install -q sentencepiece protobuf

# Check GPU
echo ""
echo "🖥️ GPU Info:"
nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader

echo ""
echo "✅ Setup complete! Ready for fine-tuning."
echo "   Upload finetune-train.jsonl, finetune-val.jsonl, and finetune-mistral.py"
echo "   Then run: python finetune-mistral.py"
