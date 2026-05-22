"""Extract miniapp scene card icons from the design sheet.

Usage:
    py scripts/extract_scene_icons.py
    py scripts/extract_scene_icons.py --source "F:/workspace/temp-png/scene-sheet.png"
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_IMAGE = Path("F:/workspace/temp-png") / "\u573a\u666f\u56fe\u8bbe\u8ba1.png"
DEFAULT_OUTPUT_DIR = ROOT / "apps" / "miniapp" / "src" / "assets" / "scenes"

SOURCE_CARD_SIZE = 248
SOURCE_RADIUS = 48


@dataclass(frozen=True)
class SceneCard:
    output_name: str
    left: int
    top: int


SCENE_CARDS = (
    SceneCard("scene-home.png", 80, 272),
    SceneCard("scene-work.png", 426, 272),
    SceneCard("scene-date.png", 772, 272),
    SceneCard("scene-sport.png", 1118, 272),
    SceneCard("scene-home-active.png", 80, 711),
    SceneCard("scene-work-active.png", 426, 711),
    SceneCard("scene-date-active.png", 772, 711),
    SceneCard("scene-sport-active.png", 1118, 711),
)


def make_round_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def export_card(source: Image.Image, card: SceneCard, output_dir: Path, output_size: int) -> Path:
    crop_box = (
        card.left,
        card.top,
        card.left + SOURCE_CARD_SIZE,
        card.top + SOURCE_CARD_SIZE,
    )
    icon = source.crop(crop_box).convert("RGBA")
    icon = icon.resize((output_size, output_size), Image.Resampling.LANCZOS)

    radius = round(SOURCE_RADIUS * output_size / SOURCE_CARD_SIZE)
    icon.putalpha(make_round_mask(output_size, radius))

    output_path = output_dir / card.output_name
    icon.save(output_path, format="PNG", optimize=True, compress_level=9)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crop 8 rounded scene icons for the Taro miniapp.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_IMAGE,
        help=f"Design sheet path. Default: {DEFAULT_SOURCE_IMAGE}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=256,
        help="Exported PNG width and height in px. Default: 256",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_path = args.source
    output_dir = args.output
    output_size = args.size

    if output_size <= 0:
        raise ValueError("--size must be a positive integer")
    if not source_path.exists():
        raise FileNotFoundError(f"Source image not found: {source_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    with Image.open(source_path) as source:
        source = source.convert("RGBA")
        exported = [
            export_card(source, card, output_dir, output_size)
            for card in SCENE_CARDS
        ]

    print(f"Exported {len(exported)} scene icons to {output_dir}")
    for path in exported:
        print(path.name)


if __name__ == "__main__":
    main()
