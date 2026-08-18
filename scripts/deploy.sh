#!/usr/bin/env bash
#
# Hameed Hliwi — deploy the current main branch onto the production VPS.
#
#   cd /home/ubuntu/hameed-hliwi && git pull && bash scripts/deploy.sh
#
# The script is written to be safe to run at two in the morning by someone who did not
# build the system. It refuses to guess:
#
#   · it will not run on a dirty checkout — local edits on the server are a red flag,
#     not something to silently overwrite
#   · it keeps the previous dist/ and the previous commit, and puts BOTH back automatically
#     if the build fails or if the site stops answering afterwards
#   · it installs dependencies only when a lockfile actually changed
#   · it never runs a database migration. Schema changes are a decision, not a side effect
#     of deploying — the script stops and tells you when one is pending.
#
# Options:
#   --rollback     undo the last deploy this script performed
#   --dry-run      show what would happen, change nothing
#   --force        rebuild even when the checkout is already the deployed commit
#   --skip-health  deploy without the post-deploy health check (not recommended)
#
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/hameed-hliwi}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
API_PROCESS="${API_PROCESS:-hameed-hliwi-api}"
WEB_PROCESS="${WEB_PROCESS:-hameed-hliwi}"
HEALTH_URL="${HEALTH_URL:-https://hameed-hliwi.org/api/v1/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-10}"
# Both live inside .git/ so they are never part of the working tree.
CURRENT_FILE=""   # the commit whose build is actually serving right now
PREVIOUS_FILE=""  # where --rollback goes

MODE="deploy"
DRY_RUN=0
SKIP_HEALTH=0
FORCE=0
for argument in "$@"; do
  case "$argument" in
    --rollback) MODE="rollback" ;;
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --skip-health) SKIP_HEALTH=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "خيار غير معروف: $argument" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;35m  ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[0;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

# ------------------------------------------------------------------ preconditions
cd "$APP_DIR" 2>/dev/null || die "المجلد غير موجود: $APP_DIR"
[ -d .git ] || die "$APP_DIR ليس مستودع git."
[ -f package.json ] || die "لا يوجد package.json في $APP_DIR — هل المسار صحيح؟"
GIT_DIR_PATH=$(git rev-parse --git-dir)
CURRENT_FILE="$GIT_DIR_PATH/deploy-current"
PREVIOUS_FILE="$GIT_DIR_PATH/deploy-previous"
command -v git >/dev/null || die "git غير مثبّت."
command -v npm >/dev/null || die "npm غير مثبّت."
HAS_PM2=0; command -v pm2 >/dev/null && HAS_PM2=1
[ "$HAS_PM2" = 1 ] || warn "pm2 غير موجود في PATH — لن تُعاد أي عملية تشغيل."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  die "ملفات متتبَّعة معدَّلة على الخادم. عالجيها أولاً — لن أدهسها."
fi

# ------------------------------------------------------------------ rollback helpers
RESTORE_COMMIT=""
DIST_BACKUP=""
ROLLING_BACK=0

restore() {
  [ "$ROLLING_BACK" = 1 ] && return 0   # never recurse into our own failure
  ROLLING_BACK=1
  say "فشل النشر — إعادة الوضع إلى ما كان عليه"
  if [ -n "$DIST_BACKUP" ] && [ -d "$DIST_BACKUP" ]; then
    rm -rf dist && mv "$DIST_BACKUP" dist && ok "أُعيدت dist السابقة."
  fi
  if [ -n "$RESTORE_COMMIT" ]; then
    git reset --hard "$RESTORE_COMMIT" >/dev/null && ok "أُعيد الكود إلى $RESTORE_COMMIT."
  fi
  restart_processes || true
  warn "راجعي الخطأ أعلاه قبل إعادة المحاولة."
}
trap restore ERR

restart_processes() {
  [ "$HAS_PM2" = 1 ] || return 0
  for process in "$@"; do
    if pm2 describe "$process" >/dev/null 2>&1; then
      run pm2 restart "$process" --update-env >/dev/null && ok "أُعيد تشغيل $process."
    else
      warn "لا توجد عملية pm2 باسم $process — تُخطّى."
    fi
  done
}

check_health() {
  [ "$SKIP_HEALTH" = 1 ] && { warn "فحص الصحة متجاوَز بطلبك."; return 0; }
  command -v curl >/dev/null || { warn "curl غير موجود — لا يمكن فحص الصحة."; return 0; }
  local attempt=1 code
  while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" || echo 000)
    if [ "$code" = "200" ]; then ok "الموقع يستجيب (200) بعد $attempt محاولة."; return 0; fi
    printf '  … محاولة %s/%s — الرد %s\n' "$attempt" "$HEALTH_RETRIES" "$code"
    sleep 3
    attempt=$((attempt + 1))
  done
  return 1
}

# ------------------------------------------------------------------ rollback mode
if [ "$MODE" = "rollback" ]; then
  [ -f "$PREVIOUS_FILE" ] || die "لا يوجد سجل نشر سابق — لا أعرف إلى أين أعود. استعملي: git reset --hard <commit>"
  PREVIOUS=$(cat "$PREVIOUS_FILE")
  say "تراجع إلى $PREVIOUS"
  run git reset --hard "$PREVIOUS"
  run npm run build
  restart_processes "$WEB_PROCESS" "$API_PROCESS"
  check_health || die "التراجع تم لكن الموقع لا يستجيب. راجعي: pm2 logs"
  [ "$DRY_RUN" = 1 ] || echo "$PREVIOUS" > "$CURRENT_FILE"
  ok "تم التراجع."
  exit 0
fi

# ------------------------------------------------------------------ fetch
BEFORE=$(git rev-parse HEAD)
RESTORE_COMMIT="$BEFORE"
say "الوضع الحالي"
printf '  المجلد   %s\n  الفرع    %s\n  الكوميت  %s — %s\n' \
  "$APP_DIR" "$BRANCH" "${BEFORE:0:8}" "$(git log -1 --pretty=%s)"

say "جلب الجديد من $REMOTE/$BRANCH"
run git fetch "$REMOTE" "$BRANCH"
TARGET=$(git rev-parse "$REMOTE/$BRANCH")

if [ "$BEFORE" = "$TARGET" ]; then
  ok "لا يوجد جديد — الخادم محدّث أصلاً."
  exit 0
fi

git --no-pager log --oneline "$BEFORE..$TARGET" | sed 's/^/  /'

# --ff-only: a deploy checkout must never produce a merge commit nobody asked for.
run git merge --ff-only "$TARGET" || die "لا يمكن التقديم السريع. الخادم متقدّم عن $REMOTE/$BRANCH أو متفرّع عنه."
AFTER=$(git rev-parse HEAD)
ok "الكود الآن على ${AFTER:0:8}."

CHANGED=$(git diff --name-only "$BEFORE" "$TARGET")   # same as AFTER once merged; also correct under --dry-run
changed_in() { echo "$CHANGED" | grep -qE "$1"; }

# ------------------------------------------------------------------ dependencies
if changed_in '^package-lock\.json$|^package\.json$'; then
  say "تبعيات الواجهة تغيّرت — تثبيت"
  run npm ci
else
  ok "لا تغيير في تبعيات الواجهة — يُتخطّى التثبيت."
fi

if changed_in '^backend/package-lock\.json$|^backend/package\.json$'; then
  say "تبعيات الخادم تغيّرت — تثبيت"
  run bash -c 'cd backend && npm ci'
fi

# ------------------------------------------------------------------ migrations: stop, do not guess
if changed_in '^backend/drizzle/'; then
  warn "هناك تغييرات في مخطط قاعدة البيانات (backend/drizzle/)."
  warn "هذا السكربت لا يشغّل أي migration. خذي نسخة احتياطية ثم شغّليها يدوياً:"
  warn "    cd $APP_DIR/backend && npm run backup:scheduled && npm run db:migrate"
  die "توقّف متعمّد. أعيدي التشغيل بعد إتمام الـ migration."
fi

# ------------------------------------------------------------------ build
if [ -d dist ] && [ "$DRY_RUN" = 0 ]; then
  DIST_BACKUP="$GIT_DIR_PATH/deploy-dist-backup.$$"
  cp -r dist "$DIST_BACKUP"
  ok "احتُفظ بنسخة من dist الحالية."
fi

say "بناء الواجهة"
run npm run build
ok "تم البناء."

if changed_in '^backend/'; then
  say "بناء الخادم"
  run bash -c 'cd backend && npm run build'
  ok "تم بناء الخادم."
  RESTART_LIST=("$WEB_PROCESS" "$API_PROCESS")
else
  ok "لا تغييرات في الخادم — لا يُعاد بناؤه ولا تشغيله."
  RESTART_LIST=("$WEB_PROCESS")
fi

# ------------------------------------------------------------------ restart & verify
say "إعادة التشغيل"
restart_processes "${RESTART_LIST[@]}"

say "فحص الصحة — $HEALTH_URL"
if ! check_health; then
  restore                      # `die` would exit without firing the ERR trap
  exit 1
fi

trap - ERR
echo "$BEFORE" > "$STATE_FILE"

say "تم النشر"
printf '  من  %s\n  إلى %s — %s\n' "${BEFORE:0:8}" "${AFTER:0:8}" "$(git log -1 --pretty=%s)"
[ -n "$DIST_BACKUP" ] && [ -d "$DIST_BACKUP" ] && rm -rf "$DIST_BACKUP"
ok "للتراجع في أي وقت:  bash scripts/deploy.sh --rollback"
