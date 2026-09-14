| model                          |       size |     params | backend    | ngl |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | --------------: | -------------------: |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           pp128 |         70.27 ± 0.06 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           pp512 |        127.75 ± 0.15 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |          pp2048 |        117.55 ± 0.37 |
| nanbeige ?B Q6_K               |   3.34 GiB |     4.17 B | CUDA       | 999 |           tg128 |          9.37 ± 0.02 |

build: fa6769818 (10896)
