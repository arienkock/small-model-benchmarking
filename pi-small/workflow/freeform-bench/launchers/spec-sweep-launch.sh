#!/usr/bin/env bash
cd /d/llama.cpp/pi-small && ./workflow/freeform-bench/spec-sweep.sh "none|" "ngsimple|--spec-type ngram-simple" "ngmod|--spec-type ngram-mod" "ngcache|--spec-type ngram-cache"
