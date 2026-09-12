@echo off
rem pure Windows environment for the pi process
set "MSYSTEM="
set "SHELL="
set "SHLVL="
set "PWD="
set "HOME=%USERPROFILE%"
"C:\Users\zenfi\AppData\Roaming\npm\pi.cmd" --mode json --no-session --no-context-files --no-extensions --no-skills --no-prompt-templates --no-themes -e "D:\llama.cpp\coding-bench\provider-extension.ts" --provider bench-local --model bench-local/%BENCH_MODEL% --append-system-prompt "You are being benchmarked. Work only inside the current working directory. Use relative paths for all file operations and commands (e.g. write server.py, run node todos.ts). Never use absolute paths. Python code must use only the Python standard library; never install packages. TypeScript files run directly with 'node file.ts'. Always verify your work by running it (as each task instructs) before finishing. If you started a server or background process to verify, stop it before you finish. When the task is done, stop; do not start unrelated work." -a -- @prompt.txt
