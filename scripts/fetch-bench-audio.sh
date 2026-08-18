#!/usr/bin/env bash
#
# Fetch and build the benchmark audio set for ticket 001.
#
# Downloads two real, freely licensed recordings and derives six test files.
# Output goes to bench-audio/, which is gitignored. Re-run to rebuild.
#
# Sources
#   Music  — "The Open Goldberg Variations", Kimiko Ishizaka, BWV 988 Aria.
#            CC0 1.0. https://archive.org/details/OpenGoldbergVariations
#   Speech — "The Wonderful Wizard of Oz (version 5)", LibriVox, chapters 1-4.
#            Public Domain Mark 1.0.
#            https://archive.org/details/wonderfulwizardofoz5_1701_librivox
#
# Requires: curl, ffmpeg.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/bench-audio"
SRC="$OUT/.src"

mkdir -p "$SRC"

IA="https://archive.org/download"
MUSIC_ITEM="OpenGoldbergVariations"
MUSIC_FILE="Kimiko Ishizaka - J.S. Bach- -Open- Goldberg Variations, BWV 988 (Piano) - 01 Aria.flac"
SPEECH_ITEM="wonderfulwizardofoz5_1701_librivox"

# WAV target format. Matches what the app's hand-written WAV writer emits
# at src/lib/audio-worker.ts:44 — 16-bit PCM.
WAV_ARGS=(-c:a pcm_s16le -ar 44100 -ac 2)
# MP3 target. 320 kbps matches the hard-coded bitrate at
# src/lib/audio-worker.ts:112.
MP3_ARGS=(-c:a libmp3lame -b:a 320k -ar 44100 -ac 2)

download() {
  local url="$1" dest="$2"
  if [[ -s "$dest" ]]; then
    echo "  have $(basename "$dest")"
    return
  fi
  echo "  get  $(basename "$dest")"
  curl -sL --fail --max-time 900 -o "$dest" "$url"
}

echo "1/4  Downloading music source (CC0)"
download "$IA/$MUSIC_ITEM/$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$MUSIC_FILE")" \
  "$SRC/music.flac"

echo "2/4  Downloading speech source (Public Domain Mark)"
for n in 01 02 03 04; do
  download "$IA/$SPEECH_ITEM/wonderfulwizardofoz_${n}_baum_128kb.mp3" \
    "$SRC/speech_${n}.mp3"
done

echo "3/4  Joining speech chapters and trimming to 45:00"
if [[ ! -s "$SRC/speech-45m.flac" ]]; then
  : >"$SRC/concat.txt"
  for n in 01 02 03 04; do
    echo "file '$SRC/speech_${n}.mp3'" >>"$SRC/concat.txt"
  done
  ffmpeg -v error -y -f concat -safe 0 -i "$SRC/concat.txt" \
    -t 2700 -c:a flac -ar 44100 -ac 2 "$SRC/speech-45m.flac"
fi

echo "4/4  Deriving the six benchmark files"

# clip-30s — first 30 seconds of the music source.
ffmpeg -v error -y -i "$SRC/music.flac" -t 30 "${WAV_ARGS[@]}" "$OUT/clip-30s.wav"
ffmpeg -v error -y -i "$SRC/music.flac" -t 30 "${MP3_ARGS[@]}" "$OUT/clip-30s.mp3"

# track-5m — the whole music source, 299.52 s.
ffmpeg -v error -y -i "$SRC/music.flac" "${WAV_ARGS[@]}" "$OUT/track-5m.wav"
ffmpeg -v error -y -i "$SRC/music.flac" "${MP3_ARGS[@]}" "$OUT/track-5m.mp3"

# podcast-45m — the joined speech, exactly 2700 s.
ffmpeg -v error -y -i "$SRC/speech-45m.flac" "${WAV_ARGS[@]}" "$OUT/podcast-45m.wav"
ffmpeg -v error -y -i "$SRC/speech-45m.flac" "${MP3_ARGS[@]}" "$OUT/podcast-45m.mp3"

echo
echo "Done. bench-audio/ holds:"
for f in clip-30s track-5m podcast-45m; do
  for e in wav mp3; do
    p="$OUT/$f.$e"
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$p")
    s=$(stat -c %s "$p")
    awk -v n="$f.$e" -v d="$d" -v s="$s" \
      'BEGIN { printf "  %-18s %8.2f s  %8.1f MB\n", n, d, s/1048576 }'
  done
done
