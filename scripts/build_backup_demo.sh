#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$ROOT/docs/GHST_Backup_Demo.mp4"

command -v ffmpeg >/dev/null || {
  echo "ffmpeg is required to render the backup demonstration."
  exit 1
}

ffmpeg -y \
  -f lavfi -i "color=c=0x081412:s=1280x720:d=72:r=30" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
  -vf "subtitles=$ROOT/docs/backup_demo.srt:force_style='FontName=DejaVu Sans,FontSize=30,PrimaryColour=&H00F4F8F7,OutlineColour=&H00112622,BackColour=&H80081210,BorderStyle=3,Outline=2,Shadow=0,MarginV=80,Alignment=5'" \
  -c:v libx264 -preset veryfast -crf 25 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -shortest -movflags +faststart \
  "$OUTPUT"

echo "$OUTPUT"
