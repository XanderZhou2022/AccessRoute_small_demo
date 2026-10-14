#!/bin/zsh
cd "${0:A:h}"
if [[ ! -d node_modules ]]; then
  print '首次使用請先在此目錄執行 npm ci。'
  read 'answer?按 Enter 關閉。'
  exit 1
fi
if curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:8787/api/health 2>/dev/null | /usr/bin/grep -q 'local-demo'; then
  if curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:5173/ >/dev/null 2>&1; then
    open http://127.0.0.1:5173/
    exit 0
  fi
fi
print '前端 http://127.0.0.1:5173/  後端 http://127.0.0.1:8787/'
(
  for attempt in {1..30}; do
    if curl --noproxy '*' -fsS --max-time 1 http://127.0.0.1:5173/ 2>/dev/null | /usr/bin/grep -q 'AccessRoute'; then
      open http://127.0.0.1:5173/
      break
    fi
    sleep 0.5
  done
) &
npm run dev
