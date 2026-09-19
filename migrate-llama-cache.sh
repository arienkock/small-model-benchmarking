#!/usr/bin/env bash
#
# migrate-llama-cache.sh — move the model cache off C: onto D:.
#
# WHY. llama.cpp (build 10896, 0.4.0-dev) caches -hf downloads in the Hugging
# Face hub layout. With no LLAMA_CACHE set it lands in ~/.cache/huggingface/hub
# on C:, which on the bench laptop is 93% full with 25 GB of weights on it. With
# LLAMA_CACHE set it uses that directory directly as the root holding
# models--<org>--<repo>/. Both roots have existed on this machine at different
# times, which is how models got "re-downloaded" without anyone deleting
# anything: the server was simply looking somewhere else.
#
# WHAT THIS DOES. Copies every cached model from the C: root to $LLAMA_CACHE on
# D:. It is ADDITIVE and re-runnable: it reads C: and writes D:, never the other
# way round, and skips any file already present at the right size. Nothing on C:
# is deleted — do that by hand once you have confirmed a model loads from D:
# (the script prints the command).
#
# Snapshot entries on C: are symlinks into blobs/; they are dereferenced into
# plain files here, and blobs/ is not copied. That is not a workaround: it is
# exactly the shape llama.cpp itself writes when LLAMA_CACHE is set (see the
# pre-existing Nanbeige Q8_0 on D:), and it halves the space the copy needs.
#
# Long, so run it detached:
#   schtasks //create //tn LlamaCacheMove //sc once //st 00:00 //f //tr \
#     "\"C:\Program Files\Git\bin\bash.exe\" -lc \"cd /d/llama.cpp && ./migrate-llama-cache.sh > cache-move.log 2>&1\""
#   schtasks //run //tn LlamaCacheMove
#
set -uo pipefail

SRC="${SRC:-/c/Users/zenfi/.cache/huggingface/hub}"
DST="${DST:-/d/llama-cache}"

[[ -d "$SRC" ]] || { echo "source cache not found: $SRC"; exit 1; }
mkdir -p "$DST" || exit 1

echo "=== llama cache migration $(date) ==="
echo "from: $SRC"
echo "to:   $DST"
df -h /c /d 2>/dev/null | tail -3
echo

copied=0 skipped=0 failed=0

for model in "$SRC"/models--*; do
	[[ -d "$model" ]] || continue
	name="$(basename "$model")"
	mkdir -p "$DST/$name/blobs" "$DST/$name/refs"
	[[ -f "$model/refs/main" ]] && cp -f "$model/refs/main" "$DST/$name/refs/main"

	for snap in "$model"/snapshots/*/; do
		[[ -d "$snap" ]] || continue
		commit="$(basename "$snap")"
		mkdir -p "$DST/$name/snapshots/$commit"
		for f in "$snap"*; do
			[[ -e "$f" ]] || continue
			base="$(basename "$f")"
			out="$DST/$name/snapshots/$commit/$base"
			# -L: follow the link, so we measure and copy the real bytes.
			size="$(stat -Lc %s "$f" 2>/dev/null)" || size=""
			if [[ -f "$out" && -n "$size" && "$(stat -c %s "$out" 2>/dev/null)" == "$size" ]]; then
				echo "skip    $name/$base (already present, $size bytes)"
				skipped=$((skipped + 1))
				continue
			fi
			echo "copying $name/$base ($size bytes) ..."
			# .part first so an interrupted copy is never mistaken for a
			# complete one by the size check above on the next run.
			if cp -L "$f" "$out.part" && mv -f "$out.part" "$out"; then
				echo "   done $name/$base"
				copied=$((copied + 1))
			else
				echo "   FAILED $name/$base"
				rm -f "$out.part"
				failed=$((failed + 1))
			fi
		done
	done
done

echo
echo "=== copied=$copied skipped=$skipped failed=$failed ==="
du -sh "$DST" 2>/dev/null
df -h /c /d 2>/dev/null | tail -3
echo
if (( failed == 0 )); then
	echo "All models are now on D:. C: is unchanged; free it with:"
	echo "    rm -rf '$SRC'"
	echo "Confirm a model loads from D: FIRST (LLAMA_CACHE=$DST)."
else
	echo "$failed file(s) failed — C: NOT safe to clear yet."
	exit 1
fi
