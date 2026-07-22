import hashlib
import json
import re
from collections import Counter
from pathlib import Path


class DatasetValidationError(ValueError):
    pass


def load_governed_dataset(path: Path) -> tuple[list[dict], str]:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    payload = json.loads(raw)
    examples = payload.get("examples", [])
    if payload.get("synthetic_or_authorised") is not True or payload.get("deidentified") is not True:
        raise DatasetValidationError("Training data must be explicitly authorised and de-identified.")
    if len(examples) < 10:
        raise DatasetValidationError("At least ten curated examples are required for a training candidate.")
    categories = Counter(str(item.get("category", "")) for item in examples)
    if not categories or min(categories.values()) < 2 or max(categories.values()) > min(categories.values()) * 2:
        raise DatasetValidationError("The curated dataset must be balanced across declared categories.")
    forbidden = re.compile(
        r"(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bsk-[A-Za-z0-9_-]{16,}\b|\bAKIA[A-Z0-9]{16}\b|\+?60\s?1\d)",
        re.I,
    )
    for index, item in enumerate(examples):
        required = {"instruction", "input", "output", "category", "partition"}
        if not required.issubset(item):
            raise DatasetValidationError(f"Example {index} is missing required fields.")
        if forbidden.search(json.dumps(item)):
            raise DatasetValidationError(f"Example {index} contains a prohibited identifier or credential pattern.")
        if item["partition"] not in {"train", "held_out"}:
            raise DatasetValidationError(f"Example {index} has an invalid partition.")
    if not any(item["partition"] == "held_out" for item in examples):
        raise DatasetValidationError("A held-out partition is mandatory.")
    return examples, digest


def render_training_text(example: dict) -> str:
    return (
        "<|system|>Classify enterprise AI governance risk. Return schema-valid JSON only.\n"
        f"<|user|>{example['instruction']}\nContent: {example['input']}\n"
        f"<|assistant|>{json.dumps(example['output'], sort_keys=True)}"
    )


def run_qlora(
    *,
    examples: list[dict],
    base_model: str,
    output_dir: Path,
    epochs: float = 1.0,
) -> dict:
    """Run private 4-bit QLoRA training when the optional isolated worker is installed."""
    try:
        import torch
        from datasets import Dataset
        from peft import LoraConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        from trl import SFTConfig, SFTTrainer
    except ImportError as exc:
        raise RuntimeError(
            "Install backend/requirements-training.txt in an isolated GPU worker before running QLoRA."
        ) from exc
    train_rows = [{"text": render_training_text(item)} for item in examples if item["partition"] == "train"]
    held_rows = [{"text": render_training_text(item)} for item in examples if item["partition"] == "held_out"]
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=False)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=quantization,
        device_map="auto",
        trust_remote_code=False,
    )
    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    training_args = SFTConfig(
        output_dir=str(output_dir),
        num_train_epochs=epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=2e-4,
        logging_steps=1,
        save_strategy="epoch",
        eval_strategy="epoch",
        dataset_text_field="text",
        max_length=2048,
        report_to="none",
    )
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=Dataset.from_list(train_rows),
        eval_dataset=Dataset.from_list(held_rows),
        processing_class=tokenizer,
        peft_config=peft_config,
    )
    result = trainer.train()
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    return {
        "trained": True,
        "backend": "QLORA",
        "train_examples": len(train_rows),
        "held_out_examples": len(held_rows),
        "train_loss": round(float(result.training_loss), 6),
        "output_path": str(output_dir),
    }
