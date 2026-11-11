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

[[ $EUID -eq 0 ]] || die "Run this as root on the Proxmox host."
command -v pct >/dev/null && command -v pveam >/dev/null && command -v pvesm >/dev/null \
  || die "This does not look like a Proxmox VE host (pct/pveam/pvesm not found)."

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
pct status "$CTID" &>/dev/null && die "Container $CTID already exists."

# Magazyn na dysk kontenera i na szablon: pierwszy aktywny obsługujący dany typ treści.
pick_storage() { pvesm status -content "$1" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}'; }
CT_STORAGE="${CT_STORAGE:-$(pick_storage rootdir)}"
TPL_STORAGE="${TPL_STORAGE:-$(pick_storage vztmpl)}"
[[ -n "$CT_STORAGE" ]]  || die "No storage for containers (rootdir) found. Set CT_STORAGE."
[[ -n "$TPL_STORAGE" ]] || die "No storage for templates (vztmpl) found. Set TPL_STORAGE."

cat <<EOF

  KumoDesk – new LXC container
  ----------------------------------------
  ID / name       : $CTID / $CT_HOSTNAME
  CPU / RAM / disk: $CT_CORES core(s) / ${CT_RAM} MB / ${CT_DISK} GB
  Storage         : $CT_STORAGE (template: $TPL_STORAGE)
  Network         : $CT_BRIDGE, IP: $CT_IP
  Repository      : $REPO ($BRANCH)
  App port        : $APP_PORT

EOF
if [[ -t 0 && "${ASSUME_YES:-0}" != 1 ]]; then
  read -r -p "Create the container? [Y/n] " a
  [[ -z "$a" || "$a" =~ ^[YyTt] ]] || die "Aborted."
fi

msg "Looking for a Debian template"
pveam update >/dev/null || true
# Szablon musi pasować do architektury hosta (lista pveam zawiera też obrazy dla innych procesorów).
ARCH="$(dpkg --print-architecture)"
pick_template() { pveam available --section system | awk '{print $2}' | grep -E "^debian-$1-standard_.*_${ARCH}\.tar\." | sort -V | tail -n1 || true; }
TEMPLATE="$(pick_template 13)"
[[ -n "$TEMPLATE" ]] || TEMPLATE="$(pick_template 12)"
[[ -n "$TEMPLATE" ]] || die "No Debian 12/13 template for architecture ${ARCH} in the pveam list."
if ! pveam list "$TPL_STORAGE" | grep -q "$TEMPLATE"; then
  msg "Downloading $TEMPLATE"
  pveam download "$TPL_STORAGE" "$TEMPLATE" >/dev/null
fi
ok "Template: $TEMPLATE (${ARCH})"

NET="name=eth0,bridge=$CT_BRIDGE,ip=$CT_IP"
[[ "$CT_IP" != dhcp && -n "$CT_GW" ]] && NET+=",gw=$CT_GW"

msg "Creating container $CTID"
pct create "$CTID" "$TPL_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_HOSTNAME" --cores "$CT_CORES" --memory "$CT_RAM" --swap "$CT_SWAP" \
  --rootfs "$CT_STORAGE:$CT_DISK" --net0 "$NET" \
  --arch "$ARCH" --unprivileged "$CT_UNPRIVILEGED" --features nesting=1 \
  --onboot 1 --ostype debian --tags kumodesk \
  --description "KumoDesk – panel decyzyjny Ichimoku D1 (port $APP_PORT). https://github.com/$REPO" >/dev/null
if ! pct start "$CTID"; then
  # nieudany start: nie zostawiamy pustego kontenera
  pct destroy "$CTID" --purge >/dev/null 2>&1 || true
  die "Container $CTID failed to start and was removed. Details: journalctl -u pve-container@$CTID -n 50"
fi
ok "Container started"

msg "Waiting for the network inside the container"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1' && break
  sleep 2
done
pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1' || die "The container has no network access (DNS)."

msg "Installing KumoDesk (a few minutes)"
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null"
pct exec "$CTID" -- bash -c "curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/install/kumodesk-install.sh | KUMODESK_REPO='$REPO' KUMODESK_BRANCH='$BRANCH' bash"

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo
ok "Done. KumoDesk is running at:  http://${IP}:${APP_PORT}"
echo "    Update:  pct exec $CTID -- update"
echo "    Logs:    pct exec $CTID -- journalctl -u kumodesk -f"
