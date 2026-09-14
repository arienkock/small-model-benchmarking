# E1-E3 results — Sun, Sep 13, 2026 12:51:20 PM

## llama-bench rows (model | size | params | backend | ngl | test | t/s)

### A-granite-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |           pp512 |        256.88 ± 0.23 |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |           tg128 |         20.01 ± 0.01 |

build: fa6769818 (10896)

### A-lfm2.5-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| lfm2 2.6B Q8_0                 |   2.67 GiB |     2.70 B | CUDA       | 999 |           pp512 |        342.05 ± 0.24 |
| lfm2 2.6B Q8_0                 |   2.67 GiB |     2.70 B | CUDA       | 999 |           tg128 |         26.64 ± 0.02 |

build: fa6769818 (10896)

### A-minicpm5-q4_k_m
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| llama ?B Q4_K - Medium         |   1.45 GiB |     2.52 B | CUDA       | 999 |           pp512 |        375.76 ± 0.40 |
| llama ?B Q4_K - Medium         |   1.45 GiB |     2.52 B | CUDA       | 999 |           tg128 |         27.02 ± 0.01 |

build: fa6769818 (10896)

### A-minicpm5-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| llama ?B Q8_0                  |   2.49 GiB |     2.52 B | CUDA       | 999 |           pp512 |       371.15 ± 24.73 |
| llama ?B Q8_0                  |   2.49 GiB |     2.52 B | CUDA       | 999 |           tg128 |         28.53 ± 0.02 |

build: fa6769818 (10896)

### A-nanbeige-q6_k
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           pp512 |        128.32 ± 0.13 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           tg128 |          9.50 ± 0.03 |

build: fa6769818 (10896)

### A-spark-q6_k
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |           pp512 |        215.25 ± 0.11 |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |           tg128 |         13.99 ± 0.01 |

build: fa6769818 (10896)

### B-sweep-granite-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |           pp128 |        135.58 ± 0.20 |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |           pp512 |        248.82 ± 0.38 |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |          pp2048 |        227.35 ± 0.16 |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |           tg128 |         19.91 ± 0.00 |

build: fa6769818 (10896)

### B-sweep-nanbeige-q6_k
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           pp128 |         70.27 ± 0.06 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           pp512 |        127.75 ± 0.15 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |          pp2048 |        117.55 ± 0.37 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           tg128 |          9.37 ± 0.02 |

build: fa6769818 (10896)

### B-sweep-spark-q6_k
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |           pp128 |        129.55 ± 0.03 |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |           pp512 |        212.13 ± 0.44 |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |          pp2048 |        198.75 ± 0.27 |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |           tg128 |         13.84 ± 0.02 |

build: fa6769818 (10896)

### C-cpu-granite-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       |   0 |           pp256 |        136.09 ± 0.25 |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       |   0 |            tg16 |          5.22 ± 0.00 |

build: fa6769818 (10896)

### C-cpu-nanbeige-q6_k
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       |   0 |           pp256 |         88.17 ± 0.12 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       |   0 |            tg16 |          2.99 ± 0.03 |

build: fa6769818 (10896)

### D-depth-granite-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |   pp512 @ d2048 |        201.54 ± 0.06 |
| granite 3B Q8_0                |   3.62 GiB |     3.66 B | CUDA       | 999 |   tg128 @ d2048 |         17.70 ± 0.01 |

build: fa6769818 (10896)

### D-depth-minicpm5-q4_k_m
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| llama ?B Q4_K - Medium         |   1.45 GiB |     2.52 B | CUDA       | 999 |   pp512 @ d2048 |        304.70 ± 0.17 |
| llama ?B Q4_K - Medium         |   1.45 GiB |     2.52 B | CUDA       | 999 |   tg128 @ d2048 |         25.76 ± 0.04 |

build: fa6769818 (10896)

### D-depth-minicpm5-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| llama ?B Q8_0                  |   2.49 GiB |     2.52 B | CUDA       | 999 |   pp512 @ d2048 |        312.45 ± 0.11 |
| llama ?B Q8_0                  |   2.49 GiB |     2.52 B | CUDA       | 999 |   tg128 @ d2048 |         27.18 ± 0.00 |

build: fa6769818 (10896)

### D-depth-nanbeige-q6_k
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |   pp512 @ d2048 |        102.64 ± 0.24 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |   tg128 @ d2048 |          8.71 ± 0.01 |

build: fa6769818 (10896)

### D-depth-spark-q6_k
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |   pp512 @ d2048 |        190.14 ± 0.30 |
| spark2_5 ?B Q6_K               |   3.14 GiB |     4.11 B | CUDA       | 999 |   tg128 @ d2048 |         13.59 ± 0.00 |

build: fa6769818 (10896)

### E-nanbeige-q8_0
| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| nanbeige ?B Q8_0               |   4.13 GiB |     4.17 B | CUDA       | 999 |           pp128 |         66.48 ± 0.04 |
| nanbeige ?B Q8_0               |   4.13 GiB |     4.17 B | CUDA       | 999 |           pp512 |        127.45 ± 0.09 |
| nanbeige ?B Q8_0               |   4.13 GiB |     4.17 B | CUDA       | 999 |          pp2048 |        116.54 ± 0.06 |
| nanbeige ?B Q8_0               |   4.13 GiB |     4.17 B | CUDA       | 999 |           tg128 |         11.38 ± 0.00 |

build: fa6769818 (10896)

### RESULTS

## Resident VRAM (MiB) observed during the probe
      1 3496
      8 3574
      7 3636
      1 3665
      4 3716
      4 3722
      1 3756
      5 3807
      8 3824
      3 3835
      4 3842
      3 3884
      7 3890
     13 3900
      7 3955
      7 3988
      3 3995
      1 4027
      3 4319
     14 4583
peak: 4583 MiB

## Offload / buffer lines (E2 — absent from every server log at verbosity 3)

### A-granite-q8_0

### A-lfm2.5-q8_0

### A-minicpm5-q4_k_m

### A-minicpm5-q8_0

### A-nanbeige-q6_k

### A-spark-q6_k

### B-sweep-granite-q8_0

### B-sweep-nanbeige-q6_k

### B-sweep-spark-q6_k

### C-cpu-granite-q8_0

### C-cpu-nanbeige-q6_k

### D-depth-granite-q8_0

### D-depth-minicpm5-q4_k_m

### D-depth-minicpm5-q8_0

### D-depth-nanbeige-q6_k

### D-depth-spark-q6_k

### E-nanbeige-q8_0
