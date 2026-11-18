#!/usr/bin/env bash
# Membuat tiga profil Hermes Agent untuk Sigap: Echo (CS WhatsApp), Tally (rekap order), Ping (pengingat).
# Aman dijalankan berulang: profil yang sudah ada tidak ditimpa.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERMES_BIN="${HERMES_BIN:-hermes}"
PORTAL_URL="${PORTAL_URL:-http://127.0.0.1:4310}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
KEY_NAME="${KEY_NAME:-FENRIR_API_KEY}"
ECHO_PROFILE="${ECHO_PROFILE:-echo}"
TALLY_PROFILE="${TALLY_PROFILE:-tally}"
PING_PROFILE="${PING_PROFILE:-ping}"

die() {
  echo "Gagal: $*" >&2
  exit 1
}

command -v "$HERMES_BIN" >/dev/null 2>&1 || die "perintah '$HERMES_BIN' tidak ditemukan. Pasang Hermes Agent dulu."
[ -f "$HERMES_HOME/.env" ] || die "$HERMES_HOME/.env tidak ada."
grep -q "^${KEY_NAME}=" "$HERMES_HOME/.env" || die "$KEY_NAME belum ada di $HERMES_HOME/.env. Isi dulu API key penyedia model Anda."

# Tambah atau ganti satu baris KEY=VALUE di berkas .env tanpa menampilkan isinya.
set_env() {
  local file="$1" key="$2" value="$3" tmp
  touch "$file"
  chmod 600 "$file"
  tmp="$(mktemp)"
  grep -v "^${key}=" "$file" >"$tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

create_profile() {
  local template="$1" name="$2" description="$3"
  local dir="$HERMES_HOME/profiles/$name"
  if [ -d "$dir" ]; then
    echo "Profil '$name' sudah ada, dilewati."
    return
  fi
  "$HERMES_BIN" profile create "$name" --no-alias --no-skills --description "$description" </dev/null >/dev/null
  cp "$ROOT/hermes/$template/config.yaml" "$dir/config.yaml"
  cp "$ROOT/hermes/$template/SOUL.md" "$dir/SOUL.md"
  # Hanya key penyedia model yang disalin. Rahasia lain di profil utama tidak ikut.
  (umask 077 && grep -m1 "^${KEY_NAME}=" "$HERMES_HOME/.env" >>"$dir/.env")
  chmod 600 "$dir/.env"
  echo "Profil '$name' dibuat."
}

create_profile echo "$ECHO_PROFILE" "Sigap: CS WhatsApp"
create_profile tally "$TALLY_PROFILE" "Sigap: rekap order"
create_profile ping "$PING_PROFILE" "Sigap: pengingat pembayaran"

ECHO_DIR="$HERMES_HOME/profiles/$ECHO_PROFILE"

# Echo adalah nomor toko: siapa pun boleh mengirim pesan. Itu sebabnya Echo tidak diberi alat apa pun.
set_env "$ECHO_DIR/.env" WHATSAPP_ENABLED true
set_env "$ECHO_DIR/.env" WHATSAPP_MODE bot
set_env "$ECHO_DIR/.env" WHATSAPP_ALLOWED_USERS '*'

# Token yang dipakai hook Hermes saat melapor ke portal. Portal membaca berkas yang sama.
mkdir -p "$DATA_DIR"
if [ ! -s "$DATA_DIR/ingest.token" ]; then
  (umask 077 && od -An -N32 -tx1 /dev/urandom | tr -d ' \n' >"$DATA_DIR/ingest.token" && printf '\n' >>"$DATA_DIR/ingest.token")
fi
TOKEN="$(tr -d ' \n' <"$DATA_DIR/ingest.token")"

HOOK_DIR="$ECHO_DIR/hooks/sigap-events"
mkdir -p "$HOOK_DIR"
cp "$ROOT/hermes/hooks/sigap-events/HOOK.yaml" "$HOOK_DIR/HOOK.yaml"
cp "$ROOT/hermes/hooks/sigap-events/handler.py" "$HOOK_DIR/handler.py"
(umask 077 && printf '{"url": "%s", "token": "%s"}\n' "$PORTAL_URL" "$TOKEN" >"$HOOK_DIR/sigap.json")
chmod 600 "$HOOK_DIR/sigap.json"
echo "Hook portal dipasang di profil '$ECHO_PROFILE'."

cat <<EOF

Selesai. Langkah berikutnya:
  1. Ganti katalog contoh di $ECHO_DIR/SOUL.md dengan katalog toko Anda.
  2. Pasangkan WhatsApp:        $HERMES_BIN -p $ECHO_PROFILE whatsapp
  3. Jalankan ulang gateway:    $HERMES_BIN gateway restart
  4. Isi DATA_SOURCE=hermes di $ROOT/.env, lalu jalankan ulang portal.

Pakai nomor WhatsApp khusus toko, bukan nomor pribadi. Sambungan lewat QR tidak resmi dan nomor bisa diblokir WhatsApp.
EOF
