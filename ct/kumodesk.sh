#!/usr/bin/env bash
# KumoDesk – instalator kontenera LXC dla Proxmox VE (uruchamiany na HOŚCIE Proxmox).
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/kbx07/kumodesk/main/ct/kumodesk.sh)"
#
# Wszystkie parametry można nadpisać zmiennymi środowiskowymi, np.:
#   CTID=120 CT_RAM=1024 CT_STORAGE=local-zfs bash -c "$(curl -fsSL .../ct/kumodesk.sh)"
set -euo pipefail

REPO="${KUMODESK_REPO:-kbx07/kumodesk}"
BRANCH="${KUMODESK_BRANCH:-main}"
APP_PORT=3003

CT_HOSTNAME="${CT_HOSTNAME:-kumodesk}"
CT_CORES="${CT_CORES:-1}"
CT_RAM="${CT_RAM:-512}"
CT_SWAP="${CT_SWAP:-512}"
CT_DISK="${CT_DISK:-4}"
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_IP="${CT_IP:-dhcp}"            # dhcp albo np. 192.168.1.50/24
CT_GW="${CT_GW:-}"                # brama, tylko przy statycznym IP
CT_UNPRIVILEGED="${CT_UNPRIVILEGED:-1}"

msg()  { echo -e "\e[1;34m==>\e[0m $*"; }
ok()   { echo -e "\e[1;32m ✓ \e[0m $*"; }
die()  { echo -e "\e[1;31m ✗ \e[0m $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Uruchom jako root na hoście Proxmox."
command -v pct >/dev/null && command -v pveam >/dev/null && command -v pvesm >/dev/null \
  || die "To nie wygląda na hosta Proxmox VE (brak pct/pveam/pvesm)."

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
pct status "$CTID" &>/dev/null && die "Kontener $CTID już istnieje."

# Magazyn na dysk kontenera i na szablon: pierwszy aktywny obsługujący dany typ treści.
pick_storage() { pvesm status -content "$1" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}'; }
CT_STORAGE="${CT_STORAGE:-$(pick_storage rootdir)}"
TPL_STORAGE="${TPL_STORAGE:-$(pick_storage vztmpl)}"
[[ -n "$CT_STORAGE" ]]  || die "Nie znaleziono magazynu dla kontenerów (rootdir). Podaj CT_STORAGE."
[[ -n "$TPL_STORAGE" ]] || die "Nie znaleziono magazynu dla szablonów (vztmpl). Podaj TPL_STORAGE."

cat <<EOF

  KumoDesk – nowy kontener LXC
  ----------------------------------------
  ID / nazwa      : $CTID / $CT_HOSTNAME
  CPU / RAM / dysk: $CT_CORES rdzeń / ${CT_RAM} MB / ${CT_DISK} GB
  Magazyn         : $CT_STORAGE (szablon: $TPL_STORAGE)
  Sieć            : $CT_BRIDGE, IP: $CT_IP
  Repozytorium    : $REPO ($BRANCH)
  Port aplikacji  : $APP_PORT

EOF
if [[ -t 0 && "${ASSUME_YES:-0}" != 1 ]]; then
  read -r -p "Utworzyć kontener? [T/n] " a
  [[ -z "$a" || "$a" =~ ^[TtYy] ]] || die "Przerwano."
fi

msg "Szukam szablonu Debiana"
pveam update >/dev/null || true
TEMPLATE="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-13-standard' | sort -V | tail -n1 || true)"
[[ -n "$TEMPLATE" ]] || TEMPLATE="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-12-standard' | sort -V | tail -n1 || true)"
[[ -n "$TEMPLATE" ]] || die "Brak szablonu Debian 12/13 na liście pveam."
if ! pveam list "$TPL_STORAGE" | grep -q "$TEMPLATE"; then
  msg "Pobieram $TEMPLATE"
  pveam download "$TPL_STORAGE" "$TEMPLATE" >/dev/null
fi
ok "Szablon: $TEMPLATE"

NET="name=eth0,bridge=$CT_BRIDGE,ip=$CT_IP"
[[ "$CT_IP" != dhcp && -n "$CT_GW" ]] && NET+=",gw=$CT_GW"

msg "Tworzę kontener $CTID"
pct create "$CTID" "$TPL_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_HOSTNAME" --cores "$CT_CORES" --memory "$CT_RAM" --swap "$CT_SWAP" \
  --rootfs "$CT_STORAGE:$CT_DISK" --net0 "$NET" \
  --unprivileged "$CT_UNPRIVILEGED" --features nesting=1 \
  --onboot 1 --ostype debian --tags kumodesk \
  --description "KumoDesk – panel decyzyjny Ichimoku D1 (port $APP_PORT). https://github.com/$REPO" >/dev/null
pct start "$CTID"
ok "Kontener uruchomiony"

msg "Czekam na sieć w kontenerze"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1' && break
  sleep 2
done
pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1' || die "Kontener nie ma dostępu do sieci (DNS)."

msg "Instaluję KumoDesk (kilka minut)"
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null"
pct exec "$CTID" -- bash -c "curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/install/kumodesk-install.sh | KUMODESK_REPO='$REPO' KUMODESK_BRANCH='$BRANCH' bash"

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo
ok "Gotowe. KumoDesk działa pod adresem:  http://${IP}:${APP_PORT}"
echo "    Aktualizacja:  pct exec $CTID -- update"
echo "    Logi:          pct exec $CTID -- journalctl -u kumodesk -f"
