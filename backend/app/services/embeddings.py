import hashlib
import math
import re


def local_embedding(text: str, dimensions: int = 128) -> list[float]:
    vector = [0.0] * dimensions
    normal = re.sub(r"\s+", " ", (text or "").strip().lower())
    if not normal:
        return vector
    for index in range(max(1, len(normal) - 2)):
        ngram = normal[index : index + 3]
        digest = hashlib.blake2b(ngram.encode(), digest_size=4).digest()
        vector[int.from_bytes(digest, "big") % dimensions] += 1.0
    norm = math.sqrt(sum(value * value for value in vector))
    if not norm:
        return vector
    return [round(value / norm, 8) for value in vector]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"
